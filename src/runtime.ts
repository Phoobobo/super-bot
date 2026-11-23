import path from 'node:path'
import { Engine, type RequestInput } from './core/engine.js'
import { UserError } from './core/errors.js'
import type { BotMessage, EffectRow, Intensity, Preference, PreferencePatch, Proposal } from './core/model.js'
import { AGENT_KINDS } from './core/model.js'
import type { AdapterResult, BacAdapter } from './bac/adapter.js'
import { FakeBac, type FakeScript } from './bac/fake.js'
import { RealBac } from './bac/real.js'
import { BAC_V1, type CapabilityProfile } from './bac/contract.js'
import { initialPreference } from './preferences/defaults.js'
import { applyPatch, buildProposal, optionOf, roleRecommendation } from './preferences/propose.js'
import { unconfiguredProvider, type QuotaProvider } from './quota.js'
import { postBotMessage, type BotTarget } from './delivery.js'
import { resolveObservation, unknownObservation, type RawObservation } from './observe.js'
import { Store } from './store.js'
import type { TakeoverSnapshot } from './takeover/snapshot.js'
import { trustListRow, type ListRow } from './takeover/snapshot.js'

export interface Clock {
  now(): Date
  ms(): number
}

export function systemClock(): Clock {
  return { now: () => new Date(), ms: () => Date.now() }
}

export interface RuntimeOptions {
  dir: string
  profile?: CapabilityProfile
  adapter?: 'fake' | 'real'
  mode?: 'dry-run' | 'live'
  allowLive?: boolean
  fakeScript?: FakeScript
  quota?: QuotaProvider
  /** When set, reply effects POST to the original bot instead of only filling the inbox. */
  bot?: BotTarget
  fetchImpl?: typeof fetch
  /** Operator-supplied model. Stored as config, not as an hc observation. */
  model?: RawObservation<string>
  clock?: Clock
  autoDrain?: boolean
  stuckAfterMs?: number
  bacBin?: string
  spawn?: ConstructorParameters<typeof RealBac>[0]['spawn']
}

export class Runtime {
  readonly store: Store
  readonly engine: Engine
  readonly adapter: BacAdapter
  readonly clock: Clock
  readonly profile: CapabilityProfile
  private readonly autoDrain: boolean
  private readonly stuckAfterMs: number
  private readonly bot?: BotTarget
  private readonly fetchImpl?: typeof fetch
  private readonly modelRaw?: RawObservation<string>
  private readonly quotaProvider: QuotaProvider

  constructor(options: RuntimeOptions) {
    this.clock = options.clock ?? systemClock()
    this.profile = options.profile ?? BAC_V1
    this.autoDrain = options.autoDrain !== false
    this.stuckAfterMs = options.stuckAfterMs ?? 15 * 60 * 1000
    this.bot = options.bot
    this.fetchImpl = options.fetchImpl
    this.modelRaw = options.model
    this.quotaProvider = options.quota ?? unconfiguredProvider
    this.store = new Store(options.dir)
    const kind = options.adapter ?? 'real'
    this.adapter =
      kind === 'fake'
        ? new FakeBac(this.profile, options.fakeScript)
        : new RealBac({
            bin: options.bacBin,
            mode: options.mode ?? 'dry-run',
            profile: this.profile,
            allowLive: options.allowLive,
            spawn: options.spawn,
          })
    this.engine = new Engine(this.store, () => this.clock.now(), {
      profile: this.profile,
      quota: options.quota ?? unconfiguredProvider,
      modelRaw: options.model,
      promptDir: path.join(options.dir, 'prompts'),
      gbbBin: options.bacBin ?? 'bac',
    })
    this.ensurePreference()
    this.recover()
  }

  close(): void {
    this.store.close()
  }

  async request(input: Omit<RequestInput, 'simulated'>): Promise<ReturnType<Engine['request']>> {
    const result = this.engine.request({ ...input, simulated: this.adapter.mode === 'fake' })
    if (this.autoDrain) await this.drain()
    return result
  }

  async takeover(snapshot: TakeoverSnapshot): Promise<{ ticketId: string }> {
    const result = this.engine.takeover(snapshot, this.adapter.mode === 'fake')
    if (this.autoDrain) await this.drain()
    return result
  }

  rejectListRow(row: ListRow): { trusted: false; reason: string } {
    return trustListRow(row)
  }

  async callback(event: Parameters<Engine['callback']>[0]): Promise<ReturnType<Engine['callback']>> {
    const result = this.engine.callback(event)
    if (this.autoDrain) await this.drain()
    return result
  }

  async evidence(
    assignmentId: string,
    producer: 'harness' | 'agent',
    checks: { id: string; ok: boolean; detail?: string }[],
    actor = 'grok-bot',
    fact: { head?: string; command?: string; output?: string; verifier?: string } = {},
  ): Promise<ReturnType<Engine['evidence']>> {
    const result = this.engine.evidence(assignmentId, producer, checks, actor, fact)
    if (this.autoDrain) await this.drain()
    return result
  }

  async cancel(ticketId: string, reason: string): Promise<ReturnType<Engine['cancel']>> {
    const result = this.engine.cancel(ticketId, reason)
    if (this.autoDrain) await this.drain()
    return result
  }

  pause(): void {
    this.store.atomic(() => this.store.setPaused(true))
  }

  async resume(): Promise<string[]> {
    this.store.atomic(() => this.store.setPaused(false))
    const opened = this.engine.resumeQueued()
    if (this.autoDrain) await this.drain()
    return opened
  }

  recommend(): Proposal {
    return this.store.atomic(() => {
      const proposal = roleRecommendation(this.currentPreference(), this.clock.now().toISOString())
      this.store.put('proposal', proposal.id, proposal)
      return proposal
    })
  }

  facts(): {
    realE2E: false
    adapter: string
    model: ReturnType<typeof resolveObservation<string>>
    quota: ReturnType<typeof resolveObservation<import('./core/model.js').QuotaValue>>
  } {
    const now = this.clock.now().toISOString()
    return {
      realE2E: false,
      adapter: this.adapter.mode,
      model: resolveObservation(this.modelRaw ?? unknownObservation('hc-get-has-no-model-field', now), this.clock.ms()),
      quota: resolveObservation(this.quotaProvider.read(now), this.clock.ms()),
    }
  }

  propose(changes: PreferencePatch): Proposal {
    return this.store.atomic(() => {
      const current = this.currentPreference()
      validatePatch(changes)
      const proposal = buildProposal(current, changes, this.clock.now().toISOString())
      this.store.put('proposal', proposal.id, proposal)
      return proposal
    })
  }

  confirm(proposalId: string, optionId: string): Preference {
    return this.store.atomic(() => {
      const proposal = this.store.get<Proposal>('proposal', proposalId)
      if (!proposal) throw new UserError('missing-proposal', '没有这条建议')
      if (proposal.status !== 'open') throw new UserError('proposal-closed', '这条建议已经处理过')
      const current = this.currentPreference()
      if (proposal.baseVersion !== current.version) throw new UserError('proposal-stale', '偏好已经变过，请重新生成建议')
      const option = optionOf(proposal, optionId)
      if (option.id === 'keep' || Object.keys(option.patch).length === 0) {
        proposal.status = 'kept'
        proposal.chosen = option.id
        this.store.put('proposal', proposal.id, proposal)
        return current
      }
      const next = applyPatch(current, option.patch, this.clock.now().toISOString(), option.title)
      this.store.put('preference', String(next.version), next)
      this.store.setMeta('preference-current', next.version)
      proposal.status = 'confirmed'
      proposal.chosen = option.id
      this.store.put('proposal', proposal.id, proposal)
      return next
    })
  }

  revert(version: number): Preference {
    return this.store.atomic(() => {
      const target = this.store.get<Preference>('preference', String(version))
      if (!target) throw new UserError('missing-preference', `没有版本 ${version}`)
      const current = this.currentPreference()
      const next: Preference = {
        ...target,
        version: current.version + 1,
        at: this.clock.now().toISOString(),
        note: `撤回至版本 ${version}`,
      }
      this.store.put('preference', String(next.version), next)
      this.store.setMeta('preference-current', next.version)
      return next
    })
  }

  currentPreference(): Preference {
    const version = this.store.meta<number>('preference-current') ?? 1
    const preference = this.store.get<Preference>('preference', String(version))
    if (!preference) throw new UserError('no-preference', '没有当前偏好')
    return preference
  }

  async tick(): Promise<void> {
    this.engine.scanStuck(this.stuckAfterMs)
    await this.drain()
  }

  async drain(max = 80): Promise<number> {
    let steps = 0
    for (; steps < max; steps += 1) {
      const peeked = this.store.nextDueEffect(this.clock.ms())
      if (!peeked) return steps
      if (this.store.paused() && peeked.kind !== 'reply' && peeked.kind !== 'status') {
        this.store.atomic(() => {
          const current = this.store.effect(peeked.kind, peeked.key)
          if (!current || current.status !== 'waiting') return
          current.due = this.clock.ms() + 60_000
          this.store.writeEffect(current)
        })
        continue
      }
      const claimed = this.store.claimEffect(peeked.kind, peeked.key, this.clock.ms())
      if (!claimed) continue
      await this.step(claimed)
    }
    throw new Error('effect drain did not settle')
  }

  view(ticketId: string): ReturnType<Engine['view']> {
    return this.engine.view(ticketId)
  }

  inbox(): ReturnType<Engine['inbox']> {
    return this.engine.inbox()
  }

  ack(messageId: string): ReturnType<Engine['ack']> {
    return this.engine.ack(messageId)
  }

  failedDeliveries(): ReturnType<Engine['failedDeliveries']> {
    return this.engine.failedDeliveries()
  }

  async retryDelivery(messageId: string): Promise<ReturnType<Engine['retryDelivery']>> {
    const message = this.engine.retryDelivery(messageId)
    if (this.autoDrain) await this.drain()
    return message
  }

  private ensurePreference(): void {
    if (this.store.meta<number>('preference-current')) return
    const preference = initialPreference(this.clock.now().toISOString())
    this.store.atomic(() => {
      this.store.put('preference', '1', preference)
      this.store.setMeta('preference-current', 1)
      this.store.setLedger({ spent: 0, reserved: 0 })
      this.store.setPaused(false)
    })
  }

  private recover(): void {
    this.store.atomic(() => {
      for (const effect of this.store.effects()) {
        if (effect.status !== 'running') continue
        if (effect.idempotent) {
          effect.status = 'waiting'
          this.store.writeEffect(effect)
        } else {
          this.engine.recoverInFlight(effect)
        }
      }
    })
  }

  private async deliverBot(row: EffectRow): Promise<AdapterResult> {
    if (!this.bot) return { outcome: 'ok', argv: [], simulated: this.adapter.mode === 'fake' }
    const id = String(row.payload.messageId ?? row.key)
    const message = this.store.get<BotMessage>('message', id)
    if (!message) return { outcome: 'ok', argv: [], simulated: false }
    try {
      const receipt = await postBotMessage(this.bot, message, this.fetchImpl)
      if (!receipt.ok) return { outcome: 'error', code: 'bot-http', message: `bot http ${receipt.status}`, argv: [] }
      return { outcome: 'ok', argv: [], simulated: false, body: { delivered: true, status: receipt.status } }
    } catch (error) {
      return { outcome: 'error', code: 'bot-http', message: error instanceof Error ? error.message : 'bot delivery failed', argv: [] }
    }
  }

  private async step(row: EffectRow): Promise<void> {
    let result: AdapterResult
    try {
      const prepared = this.engine.prepareCall(row)
      if (!prepared) throw new Error(`nothing to call for ${row.kind}`)
      if (prepared.op === 'reply') result = await this.deliverBot(row)
      else if (prepared.op === 'read') result = await this.adapter.read(prepared.args)
      else result = await this.adapter[prepared.op](prepared.args)
    } catch (error) {
      this.engine.failClosed(row, error instanceof Error ? error.message : String(error))
      return
    }
    this.engine.applyAdapterResult(row, result)
  }
}

function validatePatch(changes: PreferencePatch): void {
  if (changes.intensity && !(['low', 'normal', 'high'] as Intensity[]).includes(changes.intensity)) {
    throw new UserError('bad-intensity', '强度只能是 low、normal、high')
  }
  if (changes.budget !== undefined && (!Number.isInteger(changes.budget) || changes.budget < 0)) {
    throw new UserError('bad-budget', '预算要是非负整数')
  }
  for (const kind of [...(changes.authorizedKinds ?? []), ...(changes.executeSubstitutes ?? [])]) {
    if (!AGENT_KINDS.includes(kind)) throw new UserError('bad-kind', `未知代理 ${kind}`)
  }
  if (changes.executeSubstitutes?.includes('pi')) {
    throw new UserError('bad-substitute', 'pi 是执行首选，不能再写成它的替代')
  }
  const kind = changes.workflow?.defaultKind
  if (kind && kind !== 'off' && kind !== 'feature' && kind !== 'bugfix' && kind !== 'verify') {
    throw new UserError('bad-workflow', '流程只能是 off、feature、bugfix、verify')
  }
  const rounds = changes.workflow?.maxReworkRounds
  if (rounds !== undefined && (!Number.isInteger(rounds) || rounds < 0 || rounds > 5)) {
    throw new UserError('bad-rework', '返工上限要是 0 到 5 的整数')
  }
}
