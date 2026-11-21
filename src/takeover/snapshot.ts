import type { AgentKind, Role } from '../core/model.js'
import { AGENT_KINDS, ROLES } from '../core/model.js'
import { UserError } from '../core/errors.js'
import type { RawObservation } from '../observe.js'

export interface TakeoverSnapshot {
  schema: 'superbot.takeover.v1'
  source: { adapter: 'gbb'; command: string; observedAt: string }
  identity: {
    paneId: string
    taskId?: string
    backend: 'hc' | 'herdr'
    origin: 'handover' | 'existing'
    owner: string
    kind: RawObservation<AgentKind>
    model: RawObservation<string>
    labelsConsistent: boolean
    labelNote?: string
  }
  authorization: {
    actor: string
    scope: string
    allowedToContinue: boolean
    acceptance: string[]
  }
  work: {
    done: { key: string; title: string }[]
    open: { key: string; title: string; role: Role }[]
    unknown: { key?: string; note: string }[]
  }
  acceptancePath: string
  repo: string
  channel: string
}

export interface ListRow {
  stale?: boolean
  task_id?: string | null
  kind?: string | null
  labels?: Record<string, string>
}

/** A gbb list/report row is never a takeover. Stale and mismatched labels are recorded, not followed. */
export function trustListRow(row: ListRow): { trusted: false; reason: string } {
  if (row.stale === true) return { trusted: false, reason: 'stale' }
  const label = row.labels?.gbb_task
  if (label && row.task_id && label !== row.task_id) return { trusted: false, reason: 'label-mismatch' }
  return { trusted: false, reason: 'list-row-is-not-a-takeover' }
}

export function parseSnapshot(input: unknown): TakeoverSnapshot {
  const errors = validateSnapshot(input)
  if (errors.length) throw new UserError('takeover-incomplete', errors.join('；'))
  return input as TakeoverSnapshot
}

export function validateSnapshot(input: unknown): string[] {
  const errors: string[] = []
  if (!input || typeof input !== 'object') return ['快照不是对象']
  const snap = input as Partial<TakeoverSnapshot>
  if (snap.schema !== 'superbot.takeover.v1') errors.push('schema 必须是 superbot.takeover.v1')
  if (!snap.source?.observedAt || snap.source.adapter !== 'gbb' || !snap.source.command) {
    errors.push('缺少 source.adapter=gbb、command、observedAt')
  }
  const idn = snap.identity
  if (!idn?.paneId) errors.push('缺少 identity.paneId')
  if (idn && idn.backend !== 'hc' && idn.backend !== 'herdr') errors.push('identity.backend 必须是 hc 或 herdr')
  if (idn && idn.origin !== 'handover' && idn.origin !== 'existing') errors.push('缺少 identity.origin')
  if (!idn?.owner) errors.push('缺少 identity.owner')
  if (typeof idn?.labelsConsistent !== 'boolean') errors.push('缺少 identity.labelsConsistent')
  errors.push(...observationErrors('identity.kind', idn?.kind, AGENT_KINDS))
  errors.push(...observationErrors('identity.model', idn?.model))
  const auth = snap.authorization
  if (!auth?.actor) errors.push('缺少 authorization.actor')
  if (!auth?.scope) errors.push('缺少 authorization.scope')
  if (auth && auth.allowedToContinue !== true) errors.push('authorization.allowedToContinue 不是 true，不能续办')
  if (!auth?.acceptance?.length) errors.push('缺少 authorization.acceptance')
  const work = snap.work
  if (!work || !Array.isArray(work.done) || !Array.isArray(work.open) || !Array.isArray(work.unknown)) {
    errors.push('work.done、work.open、work.unknown 都必须是数组，可以是空数组')
  } else {
    const keys = new Set<string>()
    for (const item of work.done) {
      if (!item?.key || !item.title) errors.push('done 项需要 key 和 title')
      else if (keys.has(item.key)) errors.push(`重复的 key ${item.key}`)
      else keys.add(item.key)
    }
    for (const item of work.open) {
      if (!item?.key || !item.title) errors.push('open 项需要 key 和 title')
      if (item?.role && !ROLES.includes(item.role)) errors.push(`open 角色非法: ${item.role}`)
      if (!item?.role) errors.push('open 项需要 role')
    }
    for (const item of work.unknown) {
      if (!item?.note) errors.push('unknown 项需要 note')
    }
  }
  if (!snap.acceptancePath) errors.push('缺少 acceptancePath')
  if (!snap.repo) errors.push('缺少 repo')
  if (!snap.channel) errors.push('缺少 channel')
  if (isPaneOnly(input)) errors.push('只有 pane id，不能当作接管')
  return errors
}

function isPaneOnly(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false
  const keys = Object.keys(input as object)
  return keys.length === 1 && keys[0] === 'paneId'
}

function observationErrors(label: string, raw: RawObservation<unknown> | undefined, allowed?: readonly string[]): string[] {
  if (!raw || (raw.status !== 'known' && raw.status !== 'unknown') || !raw.source) {
    return [`${label} 需要 status 与 source`]
  }
  if (raw.status === 'unknown' && raw.value !== undefined) {
    return [`${label} 标成 unknown 时不能带 value`]
  }
  if (raw.status === 'known') {
    if (raw.value === undefined || !raw.observedAt) return [`${label} 标成 known 时需要 value 和 observedAt`]
    if (allowed && !allowed.includes(String(raw.value))) return [`${label} 的值不在允许列表`]
  }
  return []
}
