import { afterEach, describe, expect, it } from 'vitest'
import type { GbbEvent } from '../src/core/model.js'
import { baseRequest, openRuntime, stock } from './helpers.js'
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

function done(taskId: string | undefined, ts: string, owner = 'grok-bot'): GbbEvent {
  return { event: 'agent_status', task_id: taskId, status: 'done', ts, owner }
}

describe('dispatch boundary', () => {
  it('does not store a success claim or accept evidence for a planned dry-run', async () => {
    const runtime = use(openRuntime({ adapter: 'real', mode: 'dry-run', profile: stock }))
    const created = await baseRequest(runtime, 'planned-1', { phases: ['design'] })
    const ticketId = created.ticketId ?? ''
    const assignment = runtime.view(ticketId).assignments[0]
    expect(assignment?.status).toBe('planned')
    const early = await runtime.callback(done(assignment?.gbbTaskId, '2026-01-01T00:00:00.000Z'))
    expect(early.rejected).toBe('not-dispatched')
    const again = await runtime.callback(done(assignment?.gbbTaskId, '2026-01-01T00:00:00.000Z'))
    expect(again.duplicate).toBe(true)
    const view = runtime.view(ticketId)
    expect(view.assignments[0]?.status).toBe('planned')
    expect(view.assignments[0]?.claim).toBeUndefined()
    const evidence = await runtime.evidence(assignment?.id ?? '', 'harness', [{ id: 'role:design', ok: true }, { id: 'tests', ok: true }])
    expect(evidence.sufficient).toBe(false)
    expect(evidence.disposition).toBe('simulation')
    expect(evidence.reason).toBe('not-dispatched')
    const after = runtime.view(ticketId)
    expect(after.ticket.phase).toBe('open')
    expect(after.ticket.end).toBeUndefined()
    expect(after.messages.some((item) => item.purpose === 'summary' && item.text.includes('harness'))).toBe(false)
  })

  it('keeps the planned assignment without a claim across restart', async () => {
    const first = use(openRuntime({ adapter: 'real', mode: 'dry-run', profile: stock, autoDrain: false }))
    const created = await baseRequest(first, 'planned-restart', { phases: ['design'] })
    await first.drain()
    const assignment = first.view(created.ticketId ?? '').assignments[0]
    await first.callback(done(assignment?.gbbTaskId, '2026-01-01T00:00:01.000Z'))
    const dir = first.store.dir
    first.close()
    opened.pop()
    const second = use(openRuntime({ dir, adapter: 'real', mode: 'dry-run', profile: stock, autoDrain: false }))
    await second.drain()
    const restored = second.view(created.ticketId ?? '').assignments[0]
    expect(restored?.status).toBe('planned')
    expect(restored?.claim).toBeUndefined()
    const replay = await second.callback(done(restored?.gbbTaskId, '2026-01-01T00:00:01.000Z'))
    expect(replay.duplicate).toBe(true)
    expect(second.view(created.ticketId ?? '').assignments[0]?.claim).toBeUndefined()
  })

  it('applies a done callback only after the assignment is running', async () => {
    const runtime = use(openRuntime({ autoDrain: false }))
    const created = await baseRequest(runtime, 'early-1', { phases: ['design'] })
    const before = runtime.view(created.ticketId ?? '').assignments[0]
    expect(before?.status).toBe('pending')
    const early = await runtime.callback(done(before?.gbbTaskId, '2026-01-01T00:00:02.000Z'))
    expect(early.rejected).toBe('not-dispatched')
    expect(runtime.view(created.ticketId ?? '').assignments[0]?.claim).toBeUndefined()
    await runtime.drain()
    expect(runtime.view(created.ticketId ?? '').assignments[0]?.status).toBe('running')
    const replay = await runtime.callback({ ...done(before?.gbbTaskId, '2026-01-01T00:00:02.000Z'), route: 'fallback' })
    expect(replay.duplicate).toBe(true)
    expect(runtime.view(created.ticketId ?? '').assignments[0]?.claim).toBeUndefined()
    const applied = await runtime.callback(done(before?.gbbTaskId, '2026-01-01T00:00:08.000Z'))
    expect(applied.rejected).toBeUndefined()
    expect(applied.duplicate).toBe(false)
    const after = runtime.view(created.ticketId ?? '').assignments[0]
    expect(after?.status).toBe('claimed')
    expect(after?.claim?.status).toBe('done')
  })

  it('does not let the wrong owner or the wrong task become execution', async () => {
    const runtime = use(openRuntime())
    const created = await baseRequest(runtime, 'wrong-1', { phases: ['design'] })
    const assignment = runtime.view(created.ticketId ?? '').assignments[0]
    const stranger = await runtime.callback(done(assignment?.gbbTaskId, '2026-01-01T00:00:03.000Z', 'other-bot'))
    expect(stranger.rejected).toBe('owner-mismatch')
    const missing = await runtime.callback(done('task-does-not-exist', '2026-01-01T00:00:04.000Z'))
    expect(missing.matched).toBe(false)
    const view = runtime.view(created.ticketId ?? '')
    expect(view.assignments[0]?.status).toBe('running')
    expect(view.assignments[0]?.claim).toBeUndefined()
    expect(view.ticket.phase).toBe('open')
  })

  it('does not accept a stale head after a real callback', async () => {
    const runtime = use(openRuntime())
    const created = await baseRequest(runtime, 'stale-1', { workflow: 'feature' })
    const trace = runtime.view(created.ticketId ?? '').assignments[0]
    if (!trace) throw new Error('missing trace')
    await runtime.callback(done(trace.gbbTaskId, '2026-01-01T00:00:05.000Z'))
    await runtime.evidence(trace.id, 'harness', [], 'grok-bot', { head: 'aaa', command: 'npm test', output: 'shape' })
    const implement = runtime.view(created.ticketId ?? '').assignments.find((item) => item.stepId === 'implement')
    if (!implement?.gbbTaskId) throw new Error('implement was not dispatched')
    await runtime.callback(done(implement.gbbTaskId, '2026-01-01T00:00:06.000Z'))
    await runtime.evidence(implement.id, 'harness', [], 'grok-bot', { head: 'bbb', command: 'npm test', output: 'patched' })
    const verify = runtime.view(created.ticketId ?? '').assignments.find((item) => item.stepId === 'verify')
    if (!verify?.gbbTaskId) throw new Error('verify was not dispatched')
    await runtime.callback(done(verify.gbbTaskId, '2026-01-01T00:00:07.000Z'))
    const stale = await runtime.evidence(verify.id, 'harness', [{ id: 'tests', ok: true }], 'grok-bot', {
      head: 'aaa',
      command: 'npm test',
      output: '1 passed',
      verifier: 'codex-verifier',
    })
    expect(stale.reason).toBe('sha-stale')
    expect(stale.sufficient).toBe(false)
    expect(runtime.view(created.ticketId ?? '').ticket.phase).toBe('open')
  })
})
