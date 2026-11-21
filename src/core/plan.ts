import type { CapabilityProfile } from '../gbb/contract.js'
import { launchRequirement } from '../gbb/contract.js'
import { mulberry32, seedUint } from './ids.js'
import type {
  AgentKind,
  Intensity,
  PlanRecord,
  Preference,
  QuotaValue,
  Role,
  Weight,
} from './model.js'
import { COST } from './model.js'
import type { RawObservation, ResolvedObservation } from '../observe.js'
import { resolveObservation } from '../observe.js'

export interface PlanInput {
  role: Role
  ticketId: string
  preference: Preference
  profile: CapabilityProfile
  modelRaw: RawObservation<string>
  quotaRaw: RawObservation<QuotaValue>
  budgetAvailable: number
  nowMs: number
  /** Set when the work stays on a pane that already exists. Kind comes from the snapshot, not from a new launch. */
  boundKind?: AgentKind
}

const PRIMARY: Record<Role, AgentKind> = { design: 'codex', verify: 'codex', execute: 'pi' }

function quotaReason(quota: ResolvedObservation<QuotaValue>): string {
  if (quota.status === 'expired') return 'quota-expired'
  if (quota.status === 'stale') return 'quota-stale'
  return 'quota-unknown'
}

function sample(items: Weight[], rng: () => number): { item: Weight; roll: number } {
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  const roll = rng()
  let cursor = roll * total
  for (const item of items) {
    cursor -= item.weight
    if (cursor < 0) return { item, roll }
  }
  const last = items[items.length - 1]
  if (!last) throw new Error('empty sample')
  return { item: last, roll }
}

function blocked(
  input: PlanInput,
  partial: {
    kind?: AgentKind
    block?: PlanRecord['block']
    model?: ResolvedObservation<string>
    quota?: ResolvedObservation<QuotaValue>
    sample: PlanRecord['sample']
  },
): PlanRecord {
  const model = partial.model ?? resolveObservation(input.modelRaw, input.nowMs)
  const quota = partial.quota ?? resolveObservation(input.quotaRaw, input.nowMs)
  return {
    role: input.role,
    outcome: 'blocked',
    kind: partial.kind,
    block: partial.block,
    model,
    quota,
    sample: partial.sample,
    estimatedCost: COST[input.preference.intensity],
    budgetAvailable: input.budgetAvailable,
    preferenceVersion: input.preference.version,
  }
}

/**
 * Pick an agent for one role.
 * Execute is pi, or a substitute the user has already confirmed. Design and verify
 * sample only inside the kinds this profile can launch and the user authorized.
 * Non-primary kinds are skipped when quota is not a fresh number.
 */
export function planAssignment(input: PlanInput): PlanRecord {
  const model = resolveObservation(input.modelRaw, input.nowMs)
  const quota = resolveObservation(input.quotaRaw, input.nowMs)
  const cost = COST[input.preference.intensity]
  const seed = `${input.preference.sampleSeed}:${input.preference.version}:${input.ticketId}:${input.role}`
  const rng = mulberry32(seedUint([seed]))
  const excluded: { kind: AgentKind; reason: string }[] = []

  if (input.boundKind) {
    if (!input.preference.authorizedKinds.includes(input.boundKind)) {
      return blocked(input, {
        kind: input.boundKind,
        model,
        quota,
        block: { code: 'not-authorized', detail: `${input.boundKind} 不在已授权候选里` },
        sample: { seed, roll: 0, considered: [], excluded, selection: 'none' },
      })
    }
    if (!input.profile.send) {
      return blocked(input, {
        kind: input.boundKind,
        model,
        quota,
        block: { code: 'capability', requirement: 'gbb.send', detail: '当前 gbb 资料没有 send' },
        sample: { seed, roll: 0, considered: [], excluded, selection: 'none' },
      })
    }
    return finish(input, input.boundKind, 'bound-pane', [], [], 0, seed, model, quota, cost)
  }

  if (input.role === 'execute' && !input.profile.launchKinds.includes('pi')) {
    excluded.push({ kind: 'pi', reason: 'capability' })
    const substitute = input.preference.executeSubstitutes.find(
      (kind) => input.profile.launchKinds.includes(kind) && input.preference.authorizedKinds.includes(kind),
    )
    if (!substitute) {
      return blocked(input, {
        kind: 'pi',
        model,
        quota,
        block: {
          code: 'capability',
          requirement: launchRequirement('pi'),
          detail: 'gbb 0.3.3 不能 launch --kind pi。没有已确认的替代，不会改派 codex。',
        },
        sample: { seed, roll: 0, considered: [], excluded, selection: 'none' },
      })
    }
    return finish(input, substitute, 'user-approved-substitute', [], excluded, 0, seed, model, quota, cost)
  }

  const considered: Weight[] = []
  const primary = PRIMARY[input.role]
  for (const item of input.preference.weights[input.role]) {
    if (!input.preference.authorizedKinds.includes(item.kind)) {
      excluded.push({ kind: item.kind, reason: 'not-authorized' })
      continue
    }
    if (!input.profile.launchKinds.includes(item.kind)) {
      excluded.push({ kind: item.kind, reason: 'capability' })
      continue
    }
    if (item.kind !== primary && !quota.usable) {
      excluded.push({ kind: item.kind, reason: quotaReason(quota) })
      continue
    }
    if (item.weight <= 0) continue
    considered.push(item)
  }
  if (considered.length === 0) {
    return blocked(input, {
      model,
      quota,
      block: { code: 'no-candidate', detail: '没有同时兼容、已授权、且额度允许探索的候选' },
      sample: { seed, roll: 0, considered, excluded, selection: 'none' },
    })
  }
  if (input.preference.unknownQuota === 'block' && !quota.usable) {
    return blocked(input, {
      model,
      quota,
      block: {
        code: quota.status === 'expired' ? 'quota_expired' : 'quota_unknown',
        detail: '额度不是一条仍有效的读数，当前偏好要求这时停下来',
      },
      sample: { seed, roll: 0, considered, excluded, selection: 'none' },
    })
  }
  const picked = sample(considered, rng)
  const selection = picked.item.kind === primary ? 'primary' : 'explored'
  return finish(input, picked.item.kind, selection, considered, excluded, picked.roll, seed, model, quota, cost)
}

function finish(
  input: PlanInput,
  kind: AgentKind,
  selection: PlanRecord['sample']['selection'],
  considered: Weight[],
  excluded: { kind: AgentKind; reason: string }[],
  roll: number,
  seed: string,
  model: ResolvedObservation<string>,
  quota: ResolvedObservation<QuotaValue>,
  cost: number,
): PlanRecord {
  const sampleRecord = { seed, roll, considered, excluded, selection }
  if (input.preference.unknownQuota === 'block' && !quota.usable) {
    const code = quota.status === 'expired' ? 'quota_expired' : quota.status === 'stale' ? 'quota_stale' : 'quota_unknown'
    return {
      role: input.role,
      outcome: 'blocked',
      kind,
      block: { code, detail: '额度不是一条仍有效的读数，当前偏好要求这时停下来' },
      model,
      quota,
      sample: sampleRecord,
      estimatedCost: cost,
      budgetAvailable: input.budgetAvailable,
      preferenceVersion: input.preference.version,
    }
  }
  if (input.budgetAvailable < cost) {
    return {
      role: input.role,
      outcome: 'blocked',
      kind,
      block: {
        code: 'budget_insufficient',
        detail: `这一阶段按${intensityName(input.preference.intensity)}记 ${cost}，本地预算还剩 ${input.budgetAvailable}`,
      },
      model,
      quota,
      sample: sampleRecord,
      estimatedCost: cost,
      budgetAvailable: input.budgetAvailable,
      preferenceVersion: input.preference.version,
    }
  }
  return {
    role: input.role,
    outcome: 'ready',
    kind,
    model,
    quota,
    sample: sampleRecord,
    estimatedCost: cost,
    budgetAvailable: input.budgetAvailable,
    preferenceVersion: input.preference.version,
  }
}

function intensityName(intensity: Intensity): string {
  if (intensity === 'low') return '低强度'
  if (intensity === 'high') return '高强度'
  return '普通强度'
}
