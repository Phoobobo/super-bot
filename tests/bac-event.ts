import { callbackEventId } from '../src/bac/callback.js'
import type { GbbEvent } from '../src/core/model.js'

/** A v1 callback. The same task and label always produce the same event_id. Route is not part of the id. */
export function doneEvent(taskId: string | undefined, label: string | number = 1, owner = 'grok-bot', paneId = 't9'): GbbEvent {
  const generation = typeof label === 'number' ? label : generationFrom(`${taskId ?? ''}|${label}`)
  const event = 'agent_status'
  const status = 'done'
  return {
    source: 'bot-as-collie',
    version: 1,
    event,
    status,
    generation,
    attempt: 1,
    event_id: callbackEventId(paneId, event, status, generation),
    task_id: taskId,
    pane_id: paneId,
    owner,
    route: 'owner',
    ts: '2026-11-23T00:00:00Z',
    backend: 'hc',
    agent_kind: 'codex',
  }
}

function generationFrom(label: string): number {
  let value = 0
  for (const char of label) value = (Math.imul(value, 33) + char.charCodeAt(0)) >>> 0
  return (value % 1_000_000) + 1
}
