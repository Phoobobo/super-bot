import { afterEach, describe, expect, it } from 'vitest'
import { postBotMessage } from '../src/delivery.js'
import { baseRequest, openRuntime } from './helpers.js'
import type { Runtime } from '../src/runtime.js'

const opened: Runtime[] = []
afterEach(() => {
  for (const runtime of opened) runtime.close()
  opened.length = 0
})

function use(runtime: Runtime): Runtime {
  opened.push(runtime)
  return runtime
}

/** Receiver contract: at-least-once delivery, dedupe on the stable message id. Not exactly-once. */
function acceptOnce(seen: Set<string>, id: string): { duplicate: boolean } {
  if (seen.has(id)) return { duplicate: true }
  seen.add(id)
  return { duplicate: false }
}

describe('outbox faults', () => {
  it('replays the same message id after a crash that followed HTTP 204', async () => {
    const seen = new Set<string>()
    const posts: string[] = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { id: string }
      posts.push(body.id)
      acceptOnce(seen, body.id)
      return new Response(null, { status: 204 })
    }
    const bot = { url: 'http://127.0.0.1/bot' }
    const first = use(openRuntime({ bot, fetchImpl, autoDrain: false }))
    const created = await baseRequest(first, 'crash-1', { phases: ['design'] })
    const reply = first.store.effects().find((effect) => effect.kind === 'reply')
    const message = first.view(created.ticketId ?? '').messages[0]
    if (!reply || !message) throw new Error('missing outbox row')
    reply.status = 'running'
    first.store.atomic(() => first.store.writeEffect(reply))
    await postBotMessage(bot, message, fetchImpl)
    const dir = first.store.dir
    first.close()
    opened.pop()
    const second = use(openRuntime({ dir, bot, fetchImpl, autoDrain: false }))
    await second.drain()
    expect(posts.length).toBeGreaterThanOrEqual(2)
    expect(new Set(posts).size).toBe(1)
    expect(seen.size).toBe(1)
    expect(second.view(created.ticketId ?? '').messages[0]?.status).toBe('delivered')
  })

  it('treats a dropped connection and a non-2xx as retryable, then allows a manual retry', async () => {
    let mode: 'drop' | 'http' | 'ok' = 'drop'
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      if (mode === 'drop') throw new TypeError('socket hang up')
      if (mode === 'http') return new Response('no', { status: 502 })
      return new Response(null, { status: 204 })
    }
    const runtime = use(openRuntime({ bot: { url: 'http://127.0.0.1/bot' }, fetchImpl, autoDrain: false }))
    const created = await baseRequest(runtime, 'drop-1', { phases: ['design'] })
    await runtime.drain()
    expect(calls).toBe(3)
    expect(runtime.failedDeliveries().length).toBeGreaterThan(0)
    mode = 'http'
    const failed = runtime.failedDeliveries()[0]
    if (!failed) throw new Error('missing failed delivery')
    await runtime.retryDelivery(failed.id)
    await runtime.drain()
    expect(runtime.failedDeliveries().some((item) => item.id === failed.id)).toBe(true)
    mode = 'ok'
    await runtime.retryDelivery(failed.id)
    await runtime.drain()
    const message = runtime.view(created.ticketId ?? '').messages.find((item) => item.id === failed.id)
    expect(message?.status).toBe('delivered')
    const before = calls
    await runtime.drain()
    expect(calls).toBe(before)
  })

  it('does not deliver a second summary when the callback owner is wrong', async () => {
    const ids: string[] = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      ids.push((JSON.parse(String(init?.body)) as { id: string }).id)
      return new Response(null, { status: 204 })
    }
    const runtime = use(openRuntime({ bot: { url: 'http://127.0.0.1/bot' }, fetchImpl }))
    const created = await baseRequest(runtime, 'owner-deliver', { phases: ['design'] })
    const before = ids.length
    const assignment = runtime.view(created.ticketId ?? '').assignments[0]
    const rejected = await runtime.callback({
      event: 'agent_status',
      task_id: assignment?.gbbTaskId,
      status: 'done',
      ts: '2026-01-01T00:00:09.000Z',
      owner: 'other-bot',
    })
    expect(rejected.rejected).toBe('owner-mismatch')
    expect(ids).toHaveLength(before)
  })
})
