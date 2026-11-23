import { createHash } from 'node:crypto'
import { acceptPaneId } from './pane.js'

export const BAC_SOURCE = 'bot-as-collie'
export const BAC_VERSION = 1

/** Fields that must not appear on a v1 callback. Model and quota stay on status, doctor, and capabilities. */
export const FORBIDDEN_CALLBACK_FIELDS = [
  'text',
  'screen',
  'prompt',
  'output',
  'stdout',
  'stderr',
  'env',
  'token',
  'header',
  'header_value',
  'secret',
  'password',
  'model',
  'quota',
  'args',
  'agent_args',
  'raw',
] as const

const KNOWN_BLOCKED = new Set([
  'hooks_review',
  'question',
  'dialog',
  'prompt_not_submitted',
  'permission',
  'auth',
  'error',
])

export interface BacCallback {
  source: typeof BAC_SOURCE
  version: typeof BAC_VERSION
  event_id: string
  generation: number
  attempt: 1
  event: string
  status?: string | null
  owner?: string | null
  route?: string
  ts?: string
  task_id?: string | null
  pane_id?: string | null
  backend?: string
  agent_kind?: string | null
  blocked_reason?: string
  fallback_reason?: string
}

export function callbackEventId(
  paneId: string,
  event: string,
  status: string | null | undefined,
  generation: number,
): string {
  const body = `bac.callback.v1\n${paneId}\n${event}\n${status ?? ''}\n${generation}`
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

export function intakeCallback(raw: object): { ok: true; event: BacCallback } | { ok: false; rejected: string } {
  const record = raw as Record<string, unknown>
  for (const field of FORBIDDEN_CALLBACK_FIELDS) {
    if (record[field] !== undefined) return { ok: false, rejected: 'forbidden_field' }
  }
  if (record.source !== BAC_SOURCE) return { ok: false, rejected: 'source' }
  if (typeof record.version !== 'number' || record.version !== BAC_VERSION) return { ok: false, rejected: 'version' }
  if (typeof record.event !== 'string' || !record.event) return { ok: false, rejected: 'event' }
  if (typeof record.event_id !== 'string' || !/^[0-9a-f]{64}$/.test(record.event_id)) {
    return { ok: false, rejected: 'event_id' }
  }
  if (typeof record.generation !== 'number' || !Number.isInteger(record.generation) || record.generation < 1) {
    return { ok: false, rejected: 'generation' }
  }
  if (record.attempt !== 1) return { ok: false, rejected: 'attempt' }
  const paneId = record.pane_id
  if (record.event !== 'test') {
    const pane = acceptPaneId(typeof paneId === 'string' ? paneId : undefined)
    if (!pane.ok) return { ok: false, rejected: 'pane_id' }
    const expected = callbackEventId(pane.paneId, record.event, statusOf(record.status), record.generation)
    if (expected !== record.event_id) return { ok: false, rejected: 'event_id' }
  }
  let blocked = typeof record.blocked_reason === 'string' ? record.blocked_reason : undefined
  if (blocked && !KNOWN_BLOCKED.has(blocked)) blocked = undefined
  return {
    ok: true,
    event: {
      source: BAC_SOURCE,
      version: BAC_VERSION,
      event_id: record.event_id,
      generation: record.generation,
      attempt: 1,
      event: record.event,
      status: statusOf(record.status),
      owner: typeof record.owner === 'string' ? record.owner : null,
      route: typeof record.route === 'string' ? record.route : undefined,
      ts: typeof record.ts === 'string' ? record.ts : undefined,
      task_id: typeof record.task_id === 'string' ? record.task_id : null,
      pane_id: typeof paneId === 'string' ? paneId : null,
      backend: typeof record.backend === 'string' ? record.backend : undefined,
      agent_kind: typeof record.agent_kind === 'string' ? record.agent_kind : null,
      blocked_reason: blocked,
      fallback_reason: typeof record.fallback_reason === 'string' ? record.fallback_reason : undefined,
    },
  }
}

function statusOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : null
}

export function callbackDedupeKey(event: { event_id?: string }): string {
  return `id:${event.event_id ?? ''}`
}
