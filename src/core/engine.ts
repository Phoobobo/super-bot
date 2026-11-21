import fs from 'node:fs'
import path from 'node:path'
import type { CapabilityProfile } from '../gbb/contract.js'
import { handoverArgs, launchArgs, readArgs, sendArgs, statusArgs, stopArgs } from '../gbb/argv.js'
import type { AdapterResult } from '../gbb/adapter.js'
import type { QuotaProvider } from '../quota.js'
import { unknownObservation } from '../observe.js'
import type { TakeoverSnapshot } from '../takeover/snapshot.js'
import { gbbTaskId, stableId } from './ids.js'
import { UserError } from './errors.js'
import type {
  Assignment,
  BotMessage,
  Decision,
  EffectRow,
  Evidence,
  GbbEvent,
  Mandate,
  Role,
  Thread,
  Ticket,
  Trigger,
} from './model.js'
import { planAssignment } from './plan.js'
import type { Store } from '../store.js'

export interface RequestInput {
  actor: string
  text: string
  scope: string
  acceptance: string[]
  acceptancePath: string
  phases: Role[]
  requestId: string
  channel: string
  repo: string
  threadKey?: string
  simulated: boolean
}

export interface EnginePorts {
  profile: CapabilityProfile
  quota: QuotaProvider
  /** Prompt files for `gbb launch --prompt-file`. Send text stays a single argv element. */
  promptDir: string
  gbbBin: string
}

/**
 * Single writer for triggers, threads, decisions, mandates, tickets, and assignments.
 * Adapter calls happen outside this class; their results come back through `applyAdapterResult`.
 */
export class Engine {
  private readonly writer = Symbol('engine-domain')

  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
    private readonly ports: EnginePorts,
  ) {
    this.store.bindDomainWriter(this.writer)
  }

  /** Domain rows (ticket, mandate, and the rest of the aggregate) change only inside this. */
  private write<T>(fn: () => T): T {
    return this.store.atomic(() => {
      this.store.enterDomain(this.writer)
      try {
        return fn()
      } finally {
        this.store.leaveDomain()
      }
    })
  }

  request(input: RequestInput): { duplicate: boolean; ticketId?: string; decisionId?: string; paused?: boolean } {
    if (!input.acceptance.length) throw new UserError('acceptance-required', '需要至少一条验收检查')
    if (!input.phases.length) throw new UserError('phases-required', '需要至少一个阶段')
    return this.write(() => {
      const triggerId = stableId('trg', [input.actor, input.requestId])
      const existing = this.store.get<Trigger>('trigger', triggerId)
      if (existing) {
        const thread = this.store.get<Thread>('thread', existing.threadKey)
        return { duplicate: true, ticketId: thread?.subscription?.ticketId, decisionId: thread?.decisionIds.at(-1) }
      }
      const threadKey = input.threadKey ?? `bot:${input.channel}:${input.requestId}`
      const thread = this.ensureThread(threadKey)
      const trigger: Trigger = {
        id: triggerId,
        source: 'grok-bot',
        actor: input.actor,
        threadKey,
        text: input.text,
        scope: input.scope,
        requestId: input.requestId,
        at: this.iso(),
        acceptance: input.acceptance,
        acceptancePath: input.acceptancePath,
        phases: input.phases,
        repo: input.repo,
        channel: input.channel,
        simulated: input.simulated,
        followUp: Boolean(thread.subscription),
      }
      this.store.put('trigger', trigger.id, trigger)
      thread.triggerIds.push(trigger.id)
      if (thread.subscription) {
        this.store.put('thread', thread.key, thread)
        return this.followUp(thread.subscription.ticketId, trigger)
      }
      thread.queued.push(trigger.id)
      this.store.put('thread', thread.key, thread)
      if (this.store.paused()) {
        this.notify('attention', input.channel, undefined, '处理已暂停，这条请求先排队，不会派工。', { requestId: input.requestId }, [
          'paused',
          trigger.id,
        ])
        return { duplicate: false, paused: true }
      }
      return this.evaluate(thread, trigger, input)
    })
  }

  resumeQueued(): string[] {
    return this.write(() => {
      const opened: string[] = []
      if (this.store.paused()) return opened
      for (const thread of this.store.list<Thread>('thread')) {
        if (!thread.queued.length || thread.subscription) continue
        const triggerId = thread.queued[0]
        if (!triggerId) continue
        const trigger = this.store.get<Trigger>('trigger', triggerId)
        if (!trigger) continue
        const input: RequestInput = {
          actor: trigger.actor,
          text: trigger.text,
          scope: trigger.scope,
          acceptance: trigger.acceptance,
          acceptancePath: trigger.acceptancePath,
          phases: trigger.phases,
          requestId: trigger.requestId,
          channel: trigger.channel,
          repo: trigger.repo,
          simulated: trigger.simulated,
        }
        const result = this.evaluate(thread, trigger, input)
        if (result.ticketId) opened.push(result.ticketId)
      }
      return opened
    })
  }

  takeover(snapshot: TakeoverSnapshot, simulated: boolean): { ticketId: string } {
    return this.write(() => {
      const threadKey = `takeover:${snapshot.identity.paneId}`
      const existing = this.store.get<Thread>('thread', threadKey)
      if (existing?.subscription) return { ticketId: existing.subscription.ticketId }
      const preference = this.preference()
      if (!preference.allowedActors.includes(snapshot.authorization.actor)) {
        throw new UserError('actor-not-allowed', '接管授权身份不在允许列表')
      }
      if (!preference.allowedActors.includes(snapshot.identity.owner)) {
        throw new UserError('owner-not-allowed', 'gbb owner 不在允许列表')
      }
      const at = this.iso()
      const ticketId = stableId('tck', ['takeover', snapshot.identity.paneId, snapshot.source.observedAt])
      const mandateId = stableId('mnd', [ticketId])
      const doneKeys = snapshot.work.done.map((item) => item.key)
      const taskId = snapshot.identity.taskId ?? gbbTaskId(ticketId)
      const kindKnown = snapshot.identity.kind.status === 'known' ? snapshot.identity.kind.value : undefined
      const ticket: Ticket = {
        id: ticketId,
        threadKey,
        mandateId,
        title: `接管 ${snapshot.identity.paneId}`,
        scope: snapshot.authorization.scope,
        acceptance: snapshot.authorization.acceptance,
        acceptancePath: snapshot.acceptancePath,
        origin: 'takeover',
        channel: snapshot.channel,
        repo: snapshot.repo,
        owner: snapshot.identity.owner,
        phase: 'open',
        assignmentIds: [],
        doneKeys,
        unknownItems: snapshot.work.unknown,
        inputs: [],
        boundPane: { paneId: snapshot.identity.paneId, taskId, kind: kindKnown },
        modelRaw: snapshot.identity.model,
        simulated,
        labelTrust: snapshot.identity.labelsConsistent,
        createdAt: at,
        handover: 'pending',
        contextRead: 'pending',
      }
      const mandate: Mandate = {
        id: mandateId,
        ticketId,
        policyVersion: preference.version,
        scope: snapshot.authorization.scope,
        strength: 'explicit',
        actor: snapshot.authorization.actor,
        source: 'takeover',
        acceptance: snapshot.authorization.acceptance,
        withdrawn: false,
        at,
      }
      this.store.put('mandate', mandate.id, mandate)
      const thread: Thread = { key: threadKey, triggerIds: [], queued: [], subscription: { ticketId }, decisionIds: [] }
      this.store.put('thread', thread.key, thread)
      snapshot.work.open.forEach((item, seq) => {
        const duplicate = doneKeys.includes(item.key)
        const assignment = this.blankAssignment(ticket, item.role, seq, item.title, item.key)
        if (duplicate) {
          assignment.status = 'skipped'
          assignment.block = { code: 'already-complete', detail: `${item.key} 已在快照的完成列表里，不再执行` }
          assignment.transport = 'none'
        } else if (!kindKnown) {
          assignment.status = 'blocked'
          assignment.transport = 'none'
          assignment.block = {
            code: 'kind-unknown',
            requirement: 'snapshot.identity.kind',
            detail: '快照没有可用的代理种类。不会把这个 pane 猜成 pi，也不会新开一个代理。',
          }
        }
        ticket.assignmentIds.push(assignment.id)
        this.store.put('assignment', assignment.id, assignment)
      })
      this.store.put('ticket', ticket.id, ticket)
      this.store.enqueueEffect({
        kind: 'handover',
        key: ticket.id,
        payload: { ticketId: ticket.id },
        idempotent: false,
        due: this.now().getTime(),
      })
      void kindKnown
      this.notify(
        'summary',
        ticket.channel,
        ticket.id,
        this.takeoverText(ticket, snapshot),
        { ticketId: ticket.id, simulated, labelTrust: ticket.labelTrust, model: snapshot.identity.model },
        ['takeover', ticket.id],
      )
      return { ticketId: ticket.id }
    })
  }

  callback(event: GbbEvent): { duplicate: boolean; matched: boolean; assignmentId?: string; rejected?: string } {
    const key = callbackDedupeKey(event)
    return this.write(() => {
      if (this.store.seenCallback(key)) return { duplicate: true, matched: true }
      const assignment = event.task_id ? this.assignmentByTask(event.task_id) : undefined
      this.store.putCallback({ key, body: event as unknown as Record<string, unknown>, at: this.iso(), assignmentId: assignment?.id })
      if (!assignment) return { duplicate: false, matched: false }
      const ticket = this.ticket(assignment.ticketId)
      if (!event.owner || event.owner !== ticket.owner) {
        return {
          duplicate: false,
          matched: false,
          rejected: event.owner ? 'owner-mismatch' : 'owner-missing',
          assignmentId: assignment.id,
        }
      }
      const status = event.status ?? ''
      if (status === 'working' || status === '') return { duplicate: false, matched: true, assignmentId: assignment.id }
      assignment.claim = { status, eventKey: key, text: event.claim, at: this.iso() }
      if (status === 'done' || status === 'idle') {
        if (assignment.status === 'running') assignment.status = 'claimed'
        this.store.put('assignment', assignment.id, assignment)
        this.considerAcceptance(assignment)
      } else if (status === 'blocked' || status === 'error') {
        assignment.status = 'blocked'
        assignment.block = {
          code: 'executor-blocked',
          detail: event.blocked_reason || status,
        }
        this.store.put('assignment', assignment.id, assignment)
        const ticket = this.ticket(assignment.ticketId)
        this.notify(
          'attention',
          ticket.channel,
          ticket.id,
          `派工 ${assignment.role} 被 gbb 标成 ${status}。这不是验收。`,
          { assignmentId: assignment.id, status, blockedReason: event.blocked_reason ?? null },
          ['blocked', assignment.id, key],
        )
      } else {
        this.store.put('assignment', assignment.id, assignment)
      }
      return { duplicate: false, matched: true, assignmentId: assignment.id }
    })
  }

  evidence(
    assignmentId: string,
    producer: 'harness' | 'agent',
    checks: { id: string; ok: boolean; detail?: string }[],
    actor: string,
  ): Evidence {
    return this.write(() => {
      const assignment = this.assignment(assignmentId)
      const mandate = this.mandate(this.ticket(assignment.ticketId).mandateId)
      if (actor !== mandate.actor) throw new UserError('actor-not-allowed', '证据提交者不是这条授权的身份')
      const evidence: Evidence = {
        id: stableId('evd', [assignmentId, producer, this.iso(), checks.map((check) => check.id).join(',')]),
        assignmentId,
        producer,
        checks,
        at: this.iso(),
        sufficient: false,
        reason: 'stored',
      }
      assignment.evidenceIds.push(evidence.id)
      this.store.put('evidence', evidence.id, evidence)
      this.store.put('assignment', assignment.id, assignment)
      this.considerAcceptance(assignment, evidence)
      return this.store.get<Evidence>('evidence', evidence.id) ?? evidence
    })
  }

  cancel(ticketId: string, reason: string): Ticket {
    return this.write(() => {
      const ticket = this.ticket(ticketId)
      if (ticket.phase === 'ended') return ticket
      const mandate = this.mandate(ticket.mandateId)
      mandate.withdrawn = true
      this.store.put('mandate', mandate.id, mandate)
      for (const assignment of this.assignmentsOf(ticket)) {
        if (assignment.status === 'accepted' || assignment.status === 'skipped' || assignment.status === 'cancelled') continue
        const wasRunningLaunch = assignment.status === 'running' && assignment.transport === 'launch' && ticket.origin === 'request'
        if (assignment.status === 'unknown') {
          assignment.block = { code: 'unknown-not-stopped', detail: '派工结果未知，取消时不会自动再发 stop 或 send。' }
        }
        this.releaseReservation(assignment)
        assignment.status = 'cancelled'
        this.store.put('assignment', assignment.id, assignment)
        this.cancelEffect(assignment.transport === 'send' ? 'send' : 'launch', assignment.id)
        if (wasRunningLaunch && assignment.gbbTaskId) {
          this.store.enqueueEffect({
            kind: 'stop',
            key: assignment.id,
            payload: { assignmentId: assignment.id },
            idempotent: false,
            due: this.now().getTime(),
          })
        }
      }
      for (const kind of ['handover', 'read'] as const) {
        const effect = this.store.effect(kind, ticket.id)
        if (effect && effect.status === 'waiting') {
          effect.status = 'cancelled'
          this.store.writeEffect(effect)
        }
      }
      ticket.phase = 'ended'
      ticket.end = { by: 'cancelled', at: this.iso(), reason }
      this.store.put('ticket', ticket.id, ticket)
      this.notify(
        'summary',
        ticket.channel,
        ticket.id,
        `工单已取消，授权撤回。${ticket.origin === 'takeover' ? '接管来的 pane 没有调用 gbb stop，标记保持原样。' : ''}${reason}`,
        { ticketId: ticket.id, reason },
        ['cancel', ticket.id],
      )
      return ticket
    })
  }

  scanStuck(stuckAfterMs: number): void {
    this.write(() => {
      const now = this.now().getTime()
      for (const assignment of this.store.list<Assignment>('assignment')) {
        if (assignment.status !== 'running' || !assignment.startedAt || assignment.stuckNotified) continue
        if (now - Date.parse(assignment.startedAt) < stuckAfterMs) continue
        assignment.attention = 'stuck'
        assignment.stuckNotified = true
        this.store.put('assignment', assignment.id, assignment)
        const ticket = this.ticket(assignment.ticketId)
        this.notify(
          'attention',
          ticket.channel,
          ticket.id,
          `派工 ${assignment.role} 仍在跑，超过等待时间。没有自动重发。`,
          { assignmentId: assignment.id, startedAt: assignment.startedAt },
          ['stuck', assignment.id],
        )
      }
    })
  }

  /** A non-idempotent effect was left `running` across a restart. Do not call gbb again. */
  recoverInFlight(row: EffectRow): void {
    this.write(() => {
      row.status = 'unknown'
      row.lastError = 'restarted while the gbb call was in flight'
      this.store.writeEffect(row)
      const assignmentId = typeof row.payload.assignmentId === 'string' ? row.payload.assignmentId : undefined
      if (assignmentId) {
        const assignment = this.store.get<Assignment>('assignment', assignmentId)
        if (assignment && assignment.status !== 'accepted' && assignment.status !== 'cancelled') {
          this.releaseReservation(assignment)
          assignment.status = 'unknown'
          assignment.block = { code: 'restart-unknown', detail: '重启时调用还没有结果，不会自动重发。' }
          this.store.put('assignment', assignment.id, assignment)
          this.enqueueStatus(assignment)
        }
      }
      if (row.kind === 'handover') {
        const ticketId = String(row.payload.ticketId ?? row.key)
        this.holdTicketAfterUnknownHandover(ticketId)
      }
    })
  }

  prepareCall(row: EffectRow): { op: EffectRow['kind']; args: string[] } | undefined {
    if (row.kind === 'reply') return { op: 'reply', args: [] }
    if (row.kind === 'handover') {
      const ticket = this.ticket(String(row.payload.ticketId ?? row.key))
      if (!ticket.boundPane) return undefined
      return { op: 'handover', args: handoverArgs(ticket.boundPane.paneId, ticket.owner) }
    }
    if (row.kind === 'read') {
      const ticket = this.ticket(String(row.payload.ticketId ?? row.key))
      const taskId = ticket.boundPane?.taskId
      if (!taskId) return undefined
      return { op: 'read', args: readArgs(taskId) }
    }
    const assignmentId = String(row.payload.assignmentId ?? row.key)
    const assignment = this.store.get<Assignment>('assignment', assignmentId)
    if (!assignment || !assignment.gbbTaskId) return undefined
    if (row.kind === 'status') return { op: 'status', args: statusArgs(assignment.gbbTaskId) }
    if (row.kind === 'stop') return { op: 'stop', args: stopArgs(assignment.gbbTaskId) }
    const ticket = this.ticket(assignment.ticketId)
    const prompt = assignment.prompt ?? ''
    if (row.kind === 'send') return { op: 'send', args: sendArgs(assignment.gbbTaskId, prompt) }
    const kind = assignment.plan?.kind
    if (!kind) return undefined
    const promptFile = path.join(this.ports.promptDir, `${assignment.id}.txt`)
    fs.mkdirSync(this.ports.promptDir, { recursive: true })
    fs.writeFileSync(promptFile, prompt, { encoding: 'utf8', mode: 0o600 })
    return {
      op: 'launch',
      args: launchArgs({
        repo: ticket.repo,
        kind,
        taskId: assignment.gbbTaskId,
        owner: ticket.owner,
        promptFile,
      }),
    }
  }

  applyAdapterResult(row: EffectRow, result: AdapterResult): void {
    this.write(() => {
      if (row.kind === 'reply') {
        this.deliverReply(row)
        return
      }
      if (row.kind === 'handover') {
        this.finishHandover(row, result)
        return
      }
      if (row.kind === 'read') {
        this.finishRead(row, result)
        return
      }
      if (result.outcome === 'unknown-timeout') {
        this.unknownResult(row, result.argv)
        return
      }
      if (result.outcome === 'blocked') {
        this.blockedResult(row, result.code, result.requirement, result.argv)
        return
      }
      if (result.outcome === 'error') {
        this.blockedResult(row, result.code, undefined, result.argv, result.message)
        return
      }
      if (result.outcome === 'planned') {
        this.plannedResult(row, result.argv)
        return
      }
      this.startedResult(row, result.argv, 'paneId' in result ? result.paneId : undefined, result.simulated)
    })
  }

  failClosed(row: EffectRow, message: string): void {
    this.write(() => {
      if (row.idempotent && row.attempts < 3) {
        row.status = 'waiting'
        row.due = this.now().getTime() + 1_000
        row.lastError = message
        this.store.writeEffect(row)
        return
      }
      row.status = row.idempotent ? 'dead' : 'unknown'
      row.lastError = message
      this.store.writeEffect(row)
      if (!row.idempotent) this.unknownResult(row, [])
    })
  }

  view(ticketId: string): {
    ticket: Ticket
    mandate: Mandate
    assignments: Assignment[]
    evidence: Evidence[]
    messages: BotMessage[]
  } {
    const ticket = this.ticket(ticketId)
    const evidence = this.store.list<Evidence>('evidence').filter((item) => ticket.assignmentIds.includes(item.assignmentId))
    const messages = this.store.list<BotMessage>('message').filter((item) => item.ticketId === ticketId)
    return { ticket, mandate: this.mandate(ticket.mandateId), assignments: this.assignmentsOf(ticket), evidence, messages }
  }

  inbox(): BotMessage[] {
    return this.store.list<BotMessage>('message').filter((item) => item.status === 'deliverable')
  }

  ack(messageId: string): BotMessage {
    return this.write(() => {
      const message = this.store.get<BotMessage>('message', messageId)
      if (!message) throw new UserError('missing-message', '没有这条回执')
      if (message.status === 'queued') throw new UserError('not-deliverable', '回执还在 outbox，尚未可投递')
      message.status = 'acked'
      this.store.put('message', message.id, message)
      return message
    })
  }

  private evaluate(thread: Thread, trigger: Trigger, input: RequestInput): { duplicate: boolean; ticketId?: string; decisionId?: string } {
    thread.queued = thread.queued.filter((id) => id !== trigger.id)
    const preference = this.preference()
    if (!preference.allowedActors.includes(trigger.actor) || preference.acceptMode !== 'explicit-only') {
      const decision = this.decide(thread, trigger, 'ignore', 'actor-not-allowed')
      this.store.put('thread', thread.key, thread)
      return { duplicate: false, decisionId: decision.id }
    }
    const decision = this.decide(thread, trigger, 'accept', 'explicit-bot-request')
    const ticket = this.openTicket(thread, trigger, input, preference.version, decision.id)
    decision.ticketId = ticket.id
    this.store.put('decision', decision.id, decision)
    thread.subscription = { ticketId: ticket.id }
    this.store.put('thread', thread.key, thread)
    this.notify(
      'acknowledgement',
      input.channel,
      ticket.id,
      `已接单 ${ticket.id}。范围：${ticket.scope}。执行结果要等 harness 证据，自报完成不算。`,
      { ticketId: ticket.id, simulated: input.simulated, phases: input.phases },
      ['ack', ticket.id],
    )
    return { duplicate: false, ticketId: ticket.id, decisionId: decision.id }
  }

  private followUp(ticketId: string, trigger: Trigger): { duplicate: boolean; ticketId: string } {
    const ticket = this.ticket(ticketId)
    ticket.inputs.push({ id: trigger.id, text: trigger.text, at: trigger.at, sent: false })
    this.store.put('ticket', ticket.id, ticket)
    this.notify(
      'attention',
      ticket.channel,
      ticket.id,
      '后续消息已记在原工单上，没有新开授权，也没有自动再发给代理。',
      { triggerId: trigger.id },
      ['follow-up', trigger.id],
    )
    return { duplicate: false, ticketId }
  }

  private openTicket(thread: Thread, trigger: Trigger, input: RequestInput, policyVersion: number, decisionId: string): Ticket {
    const ticketId = stableId('tck', [trigger.id])
    const mandate: Mandate = {
      id: stableId('mnd', [ticketId]),
      ticketId,
      policyVersion,
      scope: input.scope,
      strength: 'explicit',
      actor: trigger.actor,
      source: 'grok-bot',
      acceptance: input.acceptance,
      withdrawn: false,
      at: this.iso(),
    }
    const ticket: Ticket = {
      id: ticketId,
      threadKey: thread.key,
      mandateId: mandate.id,
      title: input.text.slice(0, 80),
      scope: input.scope,
      acceptance: input.acceptance,
      acceptancePath: input.acceptancePath,
      origin: 'request',
      triggerId: trigger.id,
      channel: input.channel,
      repo: input.repo,
      owner: 'grok-bot',
      phase: 'open',
      assignmentIds: [],
      doneKeys: [],
      unknownItems: [],
      inputs: [],
      simulated: input.simulated,
      labelTrust: true,
      createdAt: this.iso(),
    }
    this.store.put('mandate', mandate.id, mandate)
    input.phases.forEach((role, seq) => {
      const assignment = this.blankAssignment(ticket, role, seq, roleTitle(role))
      ticket.assignmentIds.push(assignment.id)
      this.store.put('assignment', assignment.id, assignment)
    })
    this.store.put('ticket', ticket.id, ticket)
    void decisionId
    this.releaseNext(ticket)
    return ticket
  }

  private blankAssignment(ticket: Ticket, role: Role, seq: number, title: string, itemKey?: string): Assignment {
    return {
      id: stableId('asg', [ticket.id, role, String(seq), itemKey ?? '']),
      ticketId: ticket.id,
      role,
      seq,
      itemKey,
      title,
      status: 'held',
      transport: 'none',
      evidenceIds: [],
      simulated: ticket.simulated,
    }
  }

  private releaseNext(ticket: Ticket): void {
    const assignments = this.assignmentsOf(ticket)
    const next = assignments.find((assignment) => assignment.status === 'held')
    if (!next) {
      this.maybeFinish(ticket)
      return
    }
    this.activate(ticket, next)
    this.store.put('ticket', ticket.id, ticket)
  }

  private activate(ticket: Ticket, assignment: Assignment): void {
    const preference = this.preference()
    const ledger = this.store.ledger()
    const available = preference.budget - ledger.spent - ledger.reserved
    const plan = planAssignment({
      role: assignment.role,
      ticketId: ticket.id,
      preference,
      profile: this.ports.profile,
      modelRaw: ticket.modelRaw ?? unknownObservation('hc-get-has-no-model-field', this.iso()),
      quotaRaw: this.ports.quota.read(this.iso()),
      budgetAvailable: available,
      nowMs: this.now().getTime(),
      boundKind: ticket.boundPane?.kind,
    })
    assignment.plan = plan
    assignment.gbbTaskId = ticket.boundPane?.taskId ?? gbbTaskId(assignment.id)
    assignment.paneId = ticket.boundPane?.paneId
    if (plan.outcome === 'blocked' || !plan.kind) {
      assignment.status = 'blocked'
      assignment.transport = 'none'
      assignment.block = plan.block
      this.store.put('assignment', assignment.id, assignment)
      this.notify(
        'attention',
        ticket.channel,
        ticket.id,
        `派工 ${assignment.role} 停住：${plan.block?.detail ?? plan.block?.code}`,
        { assignmentId: assignment.id, block: plan.block ?? null, quota: plan.quota, model: plan.model },
        ['plan-blocked', assignment.id],
      )
      return
    }
    ledger.reserved += plan.estimatedCost
    this.store.setLedger(ledger)
    assignment.reservedCost = plan.estimatedCost
    assignment.status = 'pending'
    assignment.transport = ticket.boundPane ? 'send' : 'launch'
    assignment.prompt = this.promptFor(ticket, assignment)
    this.store.put('assignment', assignment.id, assignment)
    this.store.enqueueEffect({
      kind: assignment.transport,
      key: assignment.id,
      payload: { assignmentId: assignment.id },
      idempotent: false,
      due: this.now().getTime(),
    })
  }

  private deliverReply(row: EffectRow): void {
    const id = String(row.payload.messageId ?? row.key)
    const message = this.store.get<BotMessage>('message', id)
    if (message && message.status === 'queued') {
      message.status = 'deliverable'
      this.store.put('message', message.id, message)
    }
    row.status = 'done'
    this.store.writeEffect(row)
  }

  private finishHandover(row: EffectRow, result: AdapterResult): void {
    const ticket = this.ticket(String(row.payload.ticketId ?? row.key))
    if (result.outcome === 'unknown-timeout') {
      row.status = 'unknown'
      row.lastError = 'handover timeout; not retried'
      this.store.writeEffect(row)
      ticket.handover = 'unknown'
      this.store.put('ticket', ticket.id, ticket)
      this.holdTicketAfterUnknownHandover(ticket.id)
      this.notify(
        'attention',
        ticket.channel,
        ticket.id,
        'gbb handover 超时，结果未知。没有 read，也没有 send。',
        { ticketId: ticket.id },
        ['handover-unknown', ticket.id],
      )
      return
    }
    if (result.outcome === 'planned') {
      row.status = 'done'
      this.store.writeEffect(row)
      ticket.handover = 'planned'
      ticket.contextRead = 'planned'
      this.store.put('ticket', ticket.id, ticket)
      this.notify(
        'attention',
        ticket.channel,
        ticket.id,
        'dry-run 只记下 gbb handover 参数。没有注册 pane，没有 gbb read，接管未完成。',
        { ticketId: ticket.id, argv: result.argv },
        ['handover-planned', ticket.id],
      )
      return
    }
    if (result.outcome === 'blocked' || result.outcome === 'error') {
      row.status = 'done'
      this.store.writeEffect(row)
      ticket.handover = 'unknown'
      this.store.put('ticket', ticket.id, ticket)
      this.holdTicketAfterUnknownHandover(ticket.id)
      return
    }
    row.status = 'done'
    this.store.writeEffect(row)
    const taskId = taskIdFrom(result)
    if (ticket.boundPane && taskId) ticket.boundPane = { ...ticket.boundPane, taskId }
    ticket.handover = 'registered'
    this.store.put('ticket', ticket.id, ticket)
    this.store.enqueueEffect({
      kind: 'read',
      key: ticket.id,
      payload: { ticketId: ticket.id },
      idempotent: true,
      due: this.now().getTime(),
    })
  }

  private finishRead(row: EffectRow, result: AdapterResult): void {
    const ticket = this.ticket(String(row.payload.ticketId ?? row.key))
    if (result.outcome === 'unknown-timeout' && row.attempts < 3) {
      row.status = 'waiting'
      row.due = this.now().getTime() + 1_000
      row.lastError = 'gbb read timeout'
      this.store.writeEffect(row)
      return
    }
    if (result.outcome === 'planned') {
      row.status = 'done'
      this.store.writeEffect(row)
      ticket.contextRead = 'planned'
      this.store.put('ticket', ticket.id, ticket)
      return
    }
    const text = result.outcome === 'ok' && typeof result.body?.text === 'string' ? result.body.text : ''
    row.status = 'done'
    this.store.writeEffect(row)
    if (result.outcome !== 'ok' || !text.trim()) {
      ticket.contextRead = text.trim() ? 'unknown' : result.outcome === 'ok' ? 'empty' : 'unknown'
      this.store.put('ticket', ticket.id, ticket)
      this.blockHeld(ticket, 'context-unread', 'gbb read 没有读到上下文。快照不能单独完成接管，也不会 send。')
      this.notify(
        'attention',
        ticket.channel,
        ticket.id,
        'gbb read 没有可用上下文。未完成项没有发出。',
        { ticketId: ticket.id, contextRead: ticket.contextRead },
        ['context-unread', ticket.id],
      )
      return
    }
    ticket.contextRead = 'read'
    ticket.observedContext = { source: 'gbb-read', text: text.slice(0, 2000), at: this.iso() }
    this.store.put('ticket', ticket.id, ticket)
    if (!ticket.boundPane?.kind) {
      this.blockHeld(ticket, 'kind-unknown', '已读到上下文，但种类未知，不会新开代理，也不会 send。')
      return
    }
    this.releaseNext(ticket)
    this.notify(
      'summary',
      ticket.channel,
      ticket.id,
      'gbb handover 已注册，并且 gbb read 读到上下文，才继续未完成项。未知项仍然不执行。',
      { ticketId: ticket.id, contextChars: text.length, simulated: result.simulated },
      ['context-read', ticket.id],
    )
  }

  private blockHeld(ticket: Ticket, code: string, detail: string): void {
    for (const assignment of this.assignmentsOf(ticket)) {
      if (assignment.status !== 'held') continue
      assignment.status = 'blocked'
      assignment.transport = 'none'
      assignment.block = { code, detail }
      this.store.put('assignment', assignment.id, assignment)
    }
  }

  private startedResult(row: EffectRow, argv: string[], paneId: string | undefined, simulated: boolean): void {
    row.status = 'done'
    this.store.writeEffect(row)
    if (row.kind === 'handover') return
    if (row.kind === 'status') return
    if (row.kind === 'stop') return
    const assignment = this.assignmentFrom(row)
    if (!assignment) return
    this.spend(assignment)
    assignment.status = 'running'
    assignment.argv = argv
    assignment.startedAt = this.iso()
    if (paneId) assignment.paneId = paneId
    assignment.simulated = simulated
    this.store.put('assignment', assignment.id, assignment)
  }

  private plannedResult(row: EffectRow, argv: string[]): void {
    row.status = 'done'
    this.store.writeEffect(row)
    const assignment = this.assignmentFrom(row)
    if (!assignment) return
    this.releaseReservation(assignment)
    assignment.status = 'planned'
    assignment.argv = argv
    assignment.simulated = false
    this.store.put('assignment', assignment.id, assignment)
    const ticket = this.ticket(assignment.ticketId)
    this.notify(
      'attention',
      ticket.channel,
      ticket.id,
      `派工 ${assignment.role} 只生成了 gbb 参数，没有执行。这是 dry-run。`,
      { assignmentId: assignment.id, argv },
      ['dry-run', assignment.id],
    )
  }

  private blockedResult(row: EffectRow, code: string, requirement: string | undefined, argv: string[], detail?: string): void {
    row.status = 'done'
    this.store.writeEffect(row)
    const assignment = this.assignmentFrom(row)
    if (!assignment) return
    this.releaseReservation(assignment)
    assignment.status = 'blocked'
    assignment.argv = argv
    assignment.block = { code, requirement, detail: detail ?? code }
    this.store.put('assignment', assignment.id, assignment)
  }

  private unknownResult(row: EffectRow, argv: string[]): void {
    row.status = 'unknown'
    row.lastError = 'timeout without a confirmed result; not retried'
    this.store.writeEffect(row)
    if (row.kind === 'handover') {
      this.holdTicketAfterUnknownHandover(String(row.payload.ticketId ?? row.key))
      return
    }
    const assignment = this.assignmentFrom(row)
    if (!assignment) return
    this.releaseReservation(assignment)
    assignment.status = 'unknown'
    assignment.argv = argv
    assignment.block = { code: 'send-timeout-unknown', detail: '调用超时且没有确认结果，不会自动重发。' }
    this.store.put('assignment', assignment.id, assignment)
    this.enqueueStatus(assignment)
    const ticket = this.ticket(assignment.ticketId)
    this.notify(
      'attention',
      ticket.channel,
      ticket.id,
      `派工 ${assignment.role} 的 gbb 调用超时，结果未知。没有重发。`,
      { assignmentId: assignment.id },
      ['unknown', assignment.id],
    )
  }

  private holdTicketAfterUnknownHandover(ticketId: string): void {
    const ticket = this.store.get<Ticket>('ticket', ticketId)
    if (!ticket) return
    ticket.handover = 'unknown'
    this.store.put('ticket', ticket.id, ticket)
    this.cancelEffect('read', ticket.id)
    for (const assignment of this.assignmentsOf(ticket)) {
      if (assignment.status === 'pending' || assignment.status === 'held') {
        this.releaseReservation(assignment)
        assignment.status = 'unknown'
        assignment.block = { code: 'handover-unknown', detail: 'handover 结果未知，续办指令没有发出。' }
        this.store.put('assignment', assignment.id, assignment)
        this.cancelEffect('send', assignment.id)
      }
    }
  }

  private considerAcceptance(assignment: Assignment, just?: Evidence): void {
    const ticket = this.ticket(assignment.ticketId)
    const required = this.requiredChecks(ticket, assignment)
    const evidence = assignment.evidenceIds
      .map((id) => this.store.get<Evidence>('evidence', id))
      .filter((item): item is Evidence => Boolean(item))
    const harness = evidence.filter((item) => item.producer === 'harness')
    const covered = required.every((id) => harness.some((item) => item.checks.some((check) => check.id === id && check.ok)))
    const failed = required.some((id) => harness.some((item) => item.checks.some((check) => check.id === id && !check.ok)))
    const claimOk = assignment.claim?.status === 'done' || assignment.claim?.status === 'idle'
    if (just && just.producer === 'agent') {
      just.sufficient = false
      just.reason = 'agent-self-report'
      this.store.put('evidence', just.id, just)
    }
    if (assignment.status === 'planned') {
      if (just) {
        just.sufficient = false
        just.reason = 'dry-run'
        this.store.put('evidence', just.id, just)
      }
      return
    }
    if (!claimOk || !covered || failed) {
      if (just && just.producer === 'harness') {
        just.sufficient = false
        just.reason = !claimOk ? 'waiting-for-callback' : 'checks-missing'
        this.store.put('evidence', just.id, just)
      }
      if (failed && claimOk) {
        assignment.status = 'blocked'
        assignment.block = { code: 'evidence_rejected', detail: 'harness 检查没有全部通过' }
        this.store.put('assignment', assignment.id, assignment)
        this.notify(
          'attention',
          ticket.channel,
          ticket.id,
          `派工 ${assignment.role} 的 harness 证据未通过。`,
          { assignmentId: assignment.id, required },
          ['evidence-rejected', assignment.id],
        )
      }
      return
    }
    for (const item of harness) {
      item.sufficient = true
      item.reason = 'harness-checks-passed'
      this.store.put('evidence', item.id, item)
    }
    assignment.status = 'accepted'
    this.store.put('assignment', assignment.id, assignment)
    this.releaseNext(ticket)
  }

  private requiredChecks(ticket: Ticket, assignment: Assignment): string[] {
    const ids = [`role:${assignment.role}`]
    const active = this.assignmentsOf(ticket).filter((item) => item.status !== 'skipped')
    const last = active[active.length - 1]
    if (last?.id === assignment.id) ids.push(...ticket.acceptance)
    return ids
  }

  private maybeFinish(ticket: Ticket): void {
    const assignments = this.assignmentsOf(ticket)
    if (!assignments.length) return
    const settled = assignments.every((item) => item.status === 'accepted' || item.status === 'skipped')
    if (!settled) return
    if (ticket.unknownItems.length) {
      this.notify(
        'attention',
        ticket.channel,
        ticket.id,
        '已完成项没有重做。未知项仍然未知，没有自动执行。',
        { unknown: ticket.unknownItems, doneKeys: ticket.doneKeys },
        ['unknown-items', ticket.id],
      )
      return
    }
    ticket.phase = 'ended'
    ticket.end = {
      by: 'completed',
      at: this.iso(),
      reason: assignments.some((item) => item.status === 'accepted') ? 'harness-accepted' : 'nothing-new',
    }
    this.store.put('ticket', ticket.id, ticket)
    this.notify('summary', ticket.channel, ticket.id, this.summaryText(ticket, assignments), this.summaryData(ticket, assignments), [
      'done',
      ticket.id,
    ])
  }

  private summaryText(ticket: Ticket, assignments: Assignment[]): string {
    const parts = assignments.map((item) => `${item.role}:${item.plan?.kind ?? '未派'}/${item.status}`)
    const sim = ticket.simulated ? '这是模拟路径，没有连接真实 gbb。' : '这不是模拟适配器。'
    return `工单 ${ticket.id} 结束。${parts.join('，')}。验收看 harness 证据，不看自报。${sim}`
  }

  private summaryData(ticket: Ticket, assignments: Assignment[]): Record<string, unknown> {
    return {
      ticketId: ticket.id,
      simulated: ticket.simulated,
      profile: this.ports.profile.id,
      assignments: assignments.map((item) => ({
        id: item.id,
        role: item.role,
        kind: item.plan?.kind ?? null,
        status: item.status,
        selection: item.plan?.sample.selection ?? null,
        model: item.plan?.model.status ?? 'unknown',
        quota: item.plan?.quota.status ?? 'unknown',
      })),
    }
  }

  private takeoverText(ticket: Ticket, snapshot: TakeoverSnapshot): string {
    return [
      `已记下 pane ${snapshot.identity.paneId} 的快照。这还不是完成的接管。`,
      `完成 ${ticket.doneKeys.length} 项，未完成 ${snapshot.work.open.length} 项，未知 ${ticket.unknownItems.length} 项。`,
      '要先 gbb handover，再 gbb read。读不到上下文就不会 send。',
      ticket.labelTrust ? '标签与快照一致。' : '标签不一致，没有用标签当身份。',
      `模型观察是 ${snapshot.identity.model.status}，来源 ${snapshot.identity.model.source}。`,
      ticket.simulated ? '这条路径是模拟适配器，不是真实 gbb。' : 'dry-run 只生成参数，不会注册 pane。',
    ].join('')
  }

  private promptFor(ticket: Ticket, assignment: Assignment): string {
    const required = this.requiredChecks(ticket, assignment)
    return [
      `工单 ${ticket.id}，角色 ${assignment.role}。`,
      `范围：${ticket.scope}`,
      `不要重复已完成项：${ticket.doneKeys.join('、') || '无'}。`,
      ticket.observedContext
        ? `gbb read 摘录：${ticket.observedContext.text.slice(0, 500)}`
        : '还没有 gbb read 上下文。',
      `未知项不要执行：${ticket.unknownItems.map((item) => item.note).join('；') || '无'}。`,
      `验收路径：${ticket.acceptancePath}`,
      `本阶段要提交的 harness 检查：${required.join('、')}。`,
      '你的完成自报不会被当成验收。',
      assignment.itemKey ? `当前项 ${assignment.itemKey}：${assignment.title}` : `当前阶段：${assignment.title}`,
    ].join('\n')
  }

  private enqueueStatus(assignment: Assignment): void {
    const existing = this.store.effect('status', assignment.id)
    if (existing) return
    this.store.enqueueEffect({
      kind: 'status',
      key: assignment.id,
      payload: { assignmentId: assignment.id },
      idempotent: true,
      due: this.now().getTime(),
    })
  }

  private spend(assignment: Assignment): void {
    if (!assignment.reservedCost) return
    const ledger = this.store.ledger()
    ledger.reserved -= assignment.reservedCost
    ledger.spent += assignment.reservedCost
    assignment.reservedCost = 0
    this.store.setLedger(ledger)
  }

  private releaseReservation(assignment: Assignment): void {
    if (!assignment.reservedCost) return
    const ledger = this.store.ledger()
    ledger.reserved -= assignment.reservedCost
    assignment.reservedCost = 0
    this.store.setLedger(ledger)
  }

  private cancelEffect(kind: EffectRow['kind'], key: string): void {
    const effect = this.store.effect(kind, key)
    if (effect && effect.status === 'waiting') {
      effect.status = 'cancelled'
      this.store.writeEffect(effect)
    }
  }

  private assignmentFrom(row: EffectRow): Assignment | undefined {
    if (row.kind === 'handover' || row.kind === 'reply') return undefined
    const assignmentId = typeof row.payload.assignmentId === 'string' ? row.payload.assignmentId : row.key
    return this.store.get<Assignment>('assignment', assignmentId)
  }

  private assignmentByTask(taskId: string): Assignment | undefined {
    return this.store.list<Assignment>('assignment').find((item) => item.gbbTaskId === taskId)
  }

  private assignmentsOf(ticket: Ticket): Assignment[] {
    return ticket.assignmentIds
      .map((id) => this.store.get<Assignment>('assignment', id))
      .filter((item): item is Assignment => Boolean(item))
      .sort((a, b) => a.seq - b.seq)
  }

  private ensureThread(key: string): Thread {
    return (
      this.store.get<Thread>('thread', key) ?? { key, triggerIds: [], queued: [], decisionIds: [] }
    )
  }

  private decide(thread: Thread, trigger: Trigger, kind: Decision['kind'], reason: string): Decision {
    const decision: Decision = {
      id: stableId('dec', [trigger.id, kind, String(thread.decisionIds.length)]),
      threadKey: thread.key,
      triggerId: trigger.id,
      kind,
      reason,
      policyVersion: this.preference().version,
      at: this.iso(),
    }
    thread.decisionIds.push(decision.id)
    this.store.put('decision', decision.id, decision)
    return decision
  }

  private notify(
    purpose: BotMessage['purpose'],
    channel: string,
    ticketId: string | undefined,
    text: string,
    data: Record<string, unknown>,
    keyParts: string[],
  ): void {
    const id = stableId('msg', keyParts)
    if (this.store.get<BotMessage>('message', id)) return
    const message: BotMessage = { id, channel, ticketId, purpose, text, data, status: 'queued', at: this.iso() }
    this.store.put('message', id, message)
    this.store.enqueueEffect({ kind: 'reply', key: id, payload: { messageId: id }, idempotent: true, due: this.now().getTime() })
  }

  private preference() {
    const version = this.store.meta<number>('preference-current') ?? 1
    const preference = this.store.get<import('./model.js').Preference>('preference', String(version))
    if (!preference) throw new UserError('no-preference', '没有当前偏好')
    return preference
  }

  private ticket(id: string): Ticket {
    const ticket = this.store.get<Ticket>('ticket', id)
    if (!ticket) throw new UserError('missing-ticket', `没有工单 ${id}`)
    return ticket
  }

  private mandate(id: string): Mandate {
    const mandate = this.store.get<Mandate>('mandate', id)
    if (!mandate) throw new UserError('missing-mandate', `没有授权 ${id}`)
    return mandate
  }

  private assignment(id: string): Assignment {
    const assignment = this.store.get<Assignment>('assignment', id)
    if (!assignment) throw new UserError('missing-assignment', `没有派工 ${id}`)
    return assignment
  }

  private iso(): string {
    return this.now().toISOString()
  }
}

export function callbackDedupeKey(event: GbbEvent): string {
  if (event.event_id) return `id:${event.event_id}`
  return `f:${event.task_id ?? ''}|${event.event}|${event.status ?? ''}|${event.ts ?? ''}`
}

function taskIdFrom(result: AdapterResult): string | undefined {
  if (result.outcome === 'ok' && typeof result.body?.task_id === 'string' && result.body.task_id) return result.body.task_id
  if (result.outcome === 'started' && result.taskId) return result.taskId
  return undefined
}

function roleTitle(role: Role): string {
  if (role === 'design') return '设计'
  if (role === 'verify') return '验证'
  return '执行'
}
