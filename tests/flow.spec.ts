import { afterEach, describe, expect, it } from 'vitest'
import { runDemos } from '../src/demo.js'
import { callbackDedupeKey } from '../src/core/engine.js'
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

describe('new request through evidence', () => {
  it('runs mandate, assignment, fake gbb, callback, harness evidence, and a summary to the bot', async () => {
    const report = await runDemos()
    expect(report.realE2E).toBe(false)
    expect(report.scenarios.every((item) => item.ok)).toBe(true)
  })

  it('does not accept an agent self-report or a callback alone', async () => {
    const runtime = use(openRuntime())
    const created = await baseRequest(runtime, 'evidence-1', { phases: ['design'] })
    const view = runtime.view(created.ticketId ?? '')
    const assignment = view.assignments[0]
    expect(assignment?.status).toBe('running')
    const event: GbbEvent = {
      event: 'agent_status',
      event_id: 'evt-1',
      task_id: assignment?.gbbTaskId,
      status: 'done',
      ts: '2026-01-01T00:00:00.000Z',
      owner: 'grok-bot',
      claim: '我做完了',
    }
    await runtime.callback(event)
    expect(runtime.view(created.ticketId ?? '').assignments[0]?.status).toBe('claimed')
    const agent = await runtime.evidence(assignment?.id ?? '', 'agent', [{ id: 'role:design', ok: true }, { id: 'tests', ok: true }])
    expect(agent.sufficient).toBe(false)
    expect(agent.reason).toBe('agent-self-report')
    expect(runtime.view(created.ticketId ?? '').ticket.phase).toBe('open')
    await runtime.evidence(assignment?.id ?? '', 'harness', [
      { id: 'role:design', ok: true },
      { id: 'tests', ok: true },
    ])
    expect(runtime.view(created.ticketId ?? '').ticket.phase).toBe('ended')
  })

  it('treats a repeated callback, including one with a different route, as the same event', async () => {
    const runtime = use(openRuntime())
    const created = await baseRequest(runtime, 'dup-1', { phases: ['design'] })
    const assignment = runtime.view(created.ticketId ?? '').assignments[0]
    const event: GbbEvent = {
      event: 'agent_status',
      task_id: assignment?.gbbTaskId,
      status: 'done',
      ts: '2026-01-01T00:00:00.000Z',
      owner: 'grok-bot',
      route: 'owner',
    }
    const first = await runtime.callback(event)
    const second = await runtime.callback({ ...event, route: 'fallback' })
    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(callbackDedupeKey(event)).toBe(callbackDedupeKey({ ...event, route: 'extra' }))
    expect(runtime.view(created.ticketId ?? '').assignments[0]?.claim?.eventKey).toBe(callbackDedupeKey(event))
  })

  it('keeps a follow-up on the same ticket and does not send it again', async () => {
    const runtime = use(openRuntime())
    const created = await baseRequest(runtime, 'thread-1', { threadKey: 'bot-thread', phases: ['design'] })
    const launches = runtime.adapter.calls.filter((call) => call.op === 'launch').length
    const follow = await baseRequest(runtime, 'thread-2', { threadKey: 'bot-thread', text: '再补一句', phases: ['design'] })
    expect(follow.ticketId).toBe(created.ticketId)
    expect(runtime.adapter.calls.filter((call) => call.op === 'launch')).toHaveLength(launches)
    expect(runtime.adapter.calls.some((call) => call.op === 'send')).toBe(false)
    const note = runtime.inbox().find((item) => item.text.includes('没有自动再发'))
    expect(note).toBeTruthy()
  })

  it('returns the same ticket for the same request id', async () => {
    const runtime = use(openRuntime())
    const first = await baseRequest(runtime, 'same')
    const second = await baseRequest(runtime, 'same')
    expect(second.duplicate).toBe(true)
    expect(second.ticketId).toBe(first.ticketId)
  })
})

describe('stock gbb limits', () => {
  it('blocks execute on pi instead of launching codex', async () => {
    const runtime = use(openRuntime({ profile: stock }))
    const created = await baseRequest(runtime, 'cap-1', { phases: ['execute'] })
    const assignment = runtime.view(created.ticketId ?? '').assignments[0]
    expect(assignment?.status).toBe('blocked')
    expect(assignment?.block?.code).toBe('capability')
    expect(assignment?.block?.requirement).toBe('gbb.launch.kind=pi')
    expect(runtime.adapter.calls.some((call) => call.op === 'launch')).toBe(false)
  })
})
