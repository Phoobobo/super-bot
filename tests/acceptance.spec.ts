import { afterEach, describe, expect, it } from 'vitest'
import { UserError } from '../src/core/errors.js'
import { exampleSnapshot } from '../src/demo.js'
import { startHttp } from '../src/http.js'
import { baseRequest, openRuntime, stock } from './helpers.js'
import type { Runtime } from '../src/runtime.js'
import type { GbbEvent } from '../src/core/model.js'

const opened: Runtime[] = []
afterEach(() => {
  for (const runtime of opened) runtime.close()
  opened.length = 0
})

function use(runtime: Runtime): Runtime {
  opened.push(runtime)
  return runtime
}

describe('acceptance gaps', () => {
  it('refuses ticket and mandate writes from outside the engine', async () => {
    const runtime = use(openRuntime())
    expect(() => runtime.store.put('ticket', 'forged', { id: 'forged' })).toThrow(UserError)
    expect(() => runtime.store.put('mandate', 'forged', { id: 'forged' })).toThrow(UserError)
    const created = await baseRequest(runtime, 'writer-1', { phases: ['design'] })
    expect(runtime.view(created.ticketId ?? '').mandate.withdrawn).toBe(false)
  })

  it('claims an effect once and delivers an outbox row after a crash window', async () => {
    const first = use(openRuntime({ autoDrain: false }))
    const created = await baseRequest(first, 'claim-1', { phases: ['design'] })
    expect(created.ticketId).toBeTruthy()
    expect(first.inbox()).toHaveLength(0)
    const launch = first.store.effects().find((effect) => effect.kind === 'launch')
    expect(launch).toBeTruthy()
    const claimed = first.store.claimEffect(launch?.kind ?? '', launch?.key ?? '', Date.now())
    const again = first.store.claimEffect(launch?.kind ?? '', launch?.key ?? '', Date.now())
    expect(claimed?.status).toBe('running')
    expect(again).toBeUndefined()
    const dir = first.store.dir
    for (const effect of first.store.effects()) {
      if (effect.kind !== 'reply') continue
      effect.status = 'running'
      first.store.atomic(() => first.store.writeEffect(effect))
    }
    first.close()
    opened.pop()
    const second = use(openRuntime({ dir, autoDrain: false }))
    await second.drain()
    const delivered = second.inbox().length
    expect(delivered).toBeGreaterThan(0)
    expect(second.inbox().every((message) => message.status === 'deliverable')).toBe(true)
    await second.drain()
    expect(second.inbox()).toHaveLength(delivered)
    expect(second.adapter.calls.filter((call) => call.op === 'launch')).toHaveLength(0)
  })

  it('does not let a callback without the ticket owner advance the claim', async () => {
    const runtime = use(openRuntime())
    const created = await baseRequest(runtime, 'owner-1', { phases: ['design'] })
    const assignment = runtime.view(created.ticketId ?? '').assignments[0]
    const event: GbbEvent = {
      event: 'agent_status',
      task_id: assignment?.gbbTaskId,
      status: 'done',
      ts: '2026-01-01T00:00:00.000Z',
    }
    const missing = await runtime.callback(event)
    const mismatch = await runtime.callback({ ...event, owner: 'other-bot', ts: '2026-01-01T00:00:01.000Z' })
    expect(missing.rejected).toBe('owner-missing')
    expect(mismatch.rejected).toBe('owner-mismatch')
    expect(runtime.view(created.ticketId ?? '').assignments[0]?.status).toBe('running')
    const [first, second] = await Promise.all([
      runtime.callback({ ...event, owner: 'grok-bot', ts: '2026-01-01T00:00:02.000Z' }),
      runtime.callback({ ...event, owner: 'grok-bot', ts: '2026-01-01T00:00:02.000Z', route: 'fallback' }),
    ])
    expect([first.duplicate, second.duplicate].filter(Boolean)).toHaveLength(1)
    expect(runtime.view(created.ticketId ?? '').assignments[0]?.status).toBe('claimed')
  })

  it('does not send takeover work until gbb read returns context', async () => {
    const empty = use(openRuntime({ profile: stock, script: { read: 'empty' } }))
    const created = await empty.takeover(exampleSnapshot())
    const view = empty.view(created.ticketId)
    expect(view.ticket.handover).toBe('registered')
    expect(view.ticket.contextRead).toBe('empty')
    expect(view.assignments.find((item) => item.itemKey === 'open-1')?.status).toBe('blocked')
    expect(empty.adapter.calls.some((call) => call.op === 'send')).toBe(false)
    expect(empty.adapter.calls.some((call) => call.op === 'read')).toBe(true)

    const dry = use(openRuntime({ adapter: 'real', mode: 'dry-run', profile: stock }))
    const planned = await dry.takeover(exampleSnapshot())
    const dryView = dry.view(planned.ticketId)
    expect(dryView.ticket.handover).toBe('planned')
    expect(dryView.ticket.contextRead).toBe('planned')
    expect(dry.adapter.calls.map((call) => call.op)).toEqual(['handover'])
    expect(dryView.assignments.find((item) => item.itemKey === 'open-1')?.status).toBe('held')
  })

  it('rejects a mismatched actor on the API and a stranger on evidence', async () => {
    const runtime = use(openRuntime({ adapter: 'real', mode: 'dry-run', profile: stock }))
    const http = await startHttp(runtime, 0)
    try {
      const mismatch = await fetch(`${http.url}/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-superbot-actor': 'grok-bot' },
        body: JSON.stringify({
          actor: 'other-bot',
          requestId: 'actor-1',
          text: '越权',
          scope: '范围',
          acceptance: ['tests'],
          phases: ['design'],
        }),
      })
      expect(mismatch.status).toBe(400)
      const body = (await mismatch.json()) as { error: { code: string } }
      expect(body.error.code).toBe('actor-mismatch')
    } finally {
      await http.close()
    }
    const created = await baseRequest(runtime, 'evidence-actor', { phases: ['design'] })
    const assignment = runtime.view(created.ticketId ?? '').assignments[0]
    await expect(runtime.evidence(assignment?.id ?? '', 'harness', [{ id: 'role:design', ok: true }], 'stranger')).rejects.toThrow(UserError)
  })
})
