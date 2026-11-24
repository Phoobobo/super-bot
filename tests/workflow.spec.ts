import { afterEach, describe, expect, it } from 'vitest'
import type { Assignment } from '../src/core/model.js'
import { defaultWeights } from '../src/preferences/defaults.js'
import { doneEvent } from './bac-event.js'
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

function done(assignment: Assignment, eventId: string) {
  return doneEvent(assignment.gbbTaskId, eventId)
}

function allowCodexExecute(runtime: Runtime) {
  runtime.confirm(runtime.propose({
    weights: { ...defaultWeights(), execute: [{ kind: 'codex', weight: 100 }] },
  }).id, 'apply')
}

async function prove(
  runtime: Runtime,
  assignment: Assignment,
  fact: { head: string; command: string; output: string; verifier?: string },
  checks: { id: string; ok: boolean }[] = [],
): Promise<void> {
  await runtime.callback(done(assignment, `${assignment.id}:${fact.head}:${fact.output}`))
  await runtime.evidence(assignment.id, 'harness', checks, 'grok-bot', fact)
}

describe('pstack workflows', () => {
  it('runs feature steps in order and keeps a single writer', async () => {
    const runtime = use(openRuntime())
    allowCodexExecute(runtime)
    const created = await baseRequest(runtime, 'feature-1', { workflow: 'feature' })
    const view = runtime.view(created.ticketId ?? '')
    expect(view.assignments.map((item) => item.stepId)).toEqual(['trace', 'implement', 'verify'])
    expect(view.assignments.map((item) => item.role)).toEqual(['design', 'execute', 'verify'])
    expect(view.assignments.map((item) => item.plan?.kind ?? item.status)).toEqual(['codex', 'held', 'held'])
    expect(view.assignments.filter((item) => item.writes && item.status === 'running')).toHaveLength(0)
    expect(view.ticket.owner).toBe('grok-bot')
    expect(view.assignments[0]?.prompt).toContain('不是第二个调度器')
    expect(view.ticket.workflow?.acceptance).toEqual(['tests'])

    const trace = view.assignments[0]
    if (!trace) throw new Error('missing trace')
    await prove(runtime, trace, { head: 'aaa', command: 'npm test', output: 'shape' })
    const mid = runtime.view(created.ticketId ?? '')
    expect(mid.assignments.find((item) => item.stepId === 'implement')?.status).toBe('running')
    expect(mid.assignments.find((item) => item.stepId === 'verify')?.status).toBe('held')
    expect(mid.assignments.filter((item) => item.writes && item.status === 'running')).toHaveLength(1)

    const implement = mid.assignments.find((item) => item.stepId === 'implement')
    if (!implement) throw new Error('missing implement')
    await runtime.evidence(implement.id, 'agent', [{ id: 'tests', ok: true }], 'grok-bot', {
      head: 'bbb',
      command: 'npm test',
      output: 'patched',
      verifier: implement.id,
    })
    expect(runtime.view(created.ticketId ?? '').ticket.phase).toBe('open')
    await prove(runtime, implement, { head: 'bbb', command: 'npm test', output: 'patched' })
    const verify = runtime.view(created.ticketId ?? '').assignments.find((item) => item.stepId === 'verify')
    if (!verify) throw new Error('missing verify')
    expect(verify.boundHead).toBe('bbb')
    expect(verify.plan?.kind).toBe('codex')
    await runtime.callback(done(verify, 'verify-implementer'))
    const rejected = await runtime.evidence(verify.id, 'harness', [{ id: 'tests', ok: true }], 'grok-bot', {
      head: 'bbb',
      command: 'npm test',
      output: '1 passed',
      verifier: implement.id,
    })
    expect(rejected.reason).toBe('verifier-is-implementer')
    expect(runtime.view(created.ticketId ?? '').ticket.phase).toBe('open')
    await prove(runtime, verify, { head: 'bbb', command: 'npm test', output: '1 passed', verifier: verify.id }, [{ id: 'tests', ok: true }])
    expect(runtime.view(created.ticketId ?? '').ticket.phase).toBe('ended')
  })

  it('rejects a stale head and stops after the rework limit', async () => {
    const runtime = use(openRuntime())
    allowCodexExecute(runtime)
    runtime.confirm(runtime.propose({ workflow: { maxReworkRounds: 1 } }).id, 'apply')
    const created = await baseRequest(runtime, 'rework-1', { workflow: 'feature' })
    let view = runtime.view(created.ticketId ?? '')
    const trace = view.assignments.find((item) => item.stepId === 'trace')
    if (!trace) throw new Error('missing trace')
    await prove(runtime, trace, { head: 'aaa', command: 'npm test', output: 'shape' })
    view = runtime.view(created.ticketId ?? '')
    const implement = view.assignments.find((item) => item.stepId === 'implement')
    if (!implement) throw new Error('missing implement')
    await prove(runtime, implement, { head: 'bbb', command: 'npm test', output: 'patched' })
    view = runtime.view(created.ticketId ?? '')
    const verify = view.assignments.find((item) => item.stepId === 'verify')
    if (!verify) throw new Error('missing verify')
    await runtime.callback(done(verify, 'verify-old'))
    const stale = await runtime.evidence(verify.id, 'harness', [{ id: 'tests', ok: true }], 'grok-bot', {
      head: 'aaa',
      command: 'npm test',
      output: 'old green',
      verifier: verify.id,
    })
    expect(stale.reason).toBe('sha-stale')
    expect(runtime.view(created.ticketId ?? '').assignments.find((item) => item.stepId === 'verify')?.block?.code).toBe('sha-stale')

    const again = await baseRequest(runtime, 'rework-2', { workflow: 'feature' })
    let current = runtime.view(again.ticketId ?? '')
    await prove(runtime, current.assignments[0] as Assignment, { head: 'aaa', command: 'npm test', output: 'shape' })
    current = runtime.view(again.ticketId ?? '')
    await prove(runtime, current.assignments.find((item) => item.stepId === 'implement') as Assignment, {
      head: 'bbb',
      command: 'npm test',
      output: 'patched',
    })
    current = runtime.view(again.ticketId ?? '')
    const firstVerify = current.assignments.find((item) => item.stepId === 'verify') as Assignment
    await runtime.callback(done(firstVerify, 'verify-fail-1'))
    await runtime.evidence(firstVerify.id, 'harness', [{ id: 'tests', ok: false }], 'grok-bot', {
      head: 'bbb',
      command: 'npm test',
      output: 'fail',
      verifier: firstVerify.id,
    })
    current = runtime.view(again.ticketId ?? '')
    expect(current.ticket.workflow?.acceptance).toEqual(['tests'])
    expect(current.ticket.workflow?.reworkRounds).toBe(1)
    const rework = current.assignments.find((item) => item.itemKey === 'rework-1')
    expect(rework?.status).toBe('running')
    expect(rework?.role).toBe('execute')
    await prove(runtime, rework as Assignment, { head: 'ccc', command: 'npm test', output: 'second patch' })
    current = runtime.view(again.ticketId ?? '')
    const secondVerify = current.assignments.find((item) => item.stepId === 'verify' && item.status === 'running')
    expect(secondVerify?.boundHead).toBe('ccc')
    await runtime.callback(done(secondVerify as Assignment, 'verify-fail-2'))
    await runtime.evidence((secondVerify as Assignment).id, 'harness', [{ id: 'tests', ok: false }], 'grok-bot', {
      head: 'ccc',
      command: 'npm test',
      output: 'still fail',
      verifier: (secondVerify as Assignment).id,
    })
    const ended = runtime.view(again.ticketId ?? '')
    expect(ended.assignments.find((item) => item.stepId === 'verify')?.block?.code).toBe('rework-limit')
    expect(ended.ticket.phase).toBe('open')
    expect(ended.assignments.filter((item) => item.itemKey?.startsWith('rework'))).toHaveLength(1)
  })

  it('verifies a bugfix on the same command and blocks pi without a substitute', async () => {
    const runtime = use(openRuntime({ profile: stock }))
    const created = await baseRequest(runtime, 'bug-1', { workflow: 'bugfix' })
    const reproduce = runtime.view(created.ticketId ?? '').assignments[0]
    expect(reproduce?.stepId).toBe('reproduce')
    expect(reproduce?.plan?.kind).toBe('codex')
    if (!reproduce) throw new Error('missing reproduce')
    await prove(runtime, reproduce, { head: 'aaa', command: 'npm test -- repro', output: 'FAIL the case' })
    const fix = runtime.view(created.ticketId ?? '').assignments.find((item) => item.stepId === 'fix')
    expect(fix?.status).toBe('blocked')
    expect(fix?.block?.code).toBe('kind_unsupported')
    expect(fix?.block?.kindSupport).toBe('rejected')
    expect(fix?.plan?.kind).toBe('pi')
    expect(runtime.adapter.calls.some((call) => call.op === 'launch' && call.argv.includes('pi'))).toBe(false)

    const sim = use(openRuntime())
    allowCodexExecute(sim)
    const ok = await baseRequest(sim, 'bug-2', { workflow: 'bugfix' })
    let view = sim.view(ok.ticketId ?? '')
    await prove(sim, view.assignments[0] as Assignment, { head: 'aaa', command: 'npm test -- repro', output: 'FAIL the case' })
    view = sim.view(ok.ticketId ?? '')
    await prove(sim, view.assignments.find((item) => item.stepId === 'fix') as Assignment, {
      head: 'bbb',
      command: 'npm test -- repro',
      output: 'patch',
    })
    view = sim.view(ok.ticketId ?? '')
    const verify = view.assignments.find((item) => item.stepId === 'verify') as Assignment
    await sim.callback(done(verify, 'same-output'))
    const stuck = await sim.evidence(verify.id, 'harness', [{ id: 'tests', ok: true }], 'grok-bot', {
      head: 'bbb',
      command: 'npm test -- repro',
      output: 'FAIL the case',
      verifier: verify.id,
    })
    expect(stuck.reason).toBe('no-progress')
    await sim.callback(done(verify, 'wrong-command'))
    const wrong = await sim.evidence(verify.id, 'harness', [{ id: 'tests', ok: true }], 'grok-bot', {
      head: 'bbb',
      command: 'npm test -- other',
      output: '1 passed',
      verifier: verify.id,
    })
    expect(wrong.reason).toBe('wrong-surface')
    await prove(sim, verify, { head: 'bbb', command: 'npm test -- repro', output: '1 passed', verifier: verify.id }, [{ id: 'tests', ok: true }])
    expect(sim.view(ok.ticketId ?? '').ticket.phase).toBe('ended')
  })

  it('keeps verify read-only and does not let a preference edit cancel in-flight work', async () => {
    const runtime = use(openRuntime())
    await expect(baseRequest(runtime, 'verify-head', { workflow: 'verify' })).rejects.toThrow(/head/)
    const created = await baseRequest(runtime, 'verify-1', { workflow: 'verify', head: 'abc123', phases: ['execute', 'verify'] })
    const view = runtime.view(created.ticketId ?? '')
    expect(view.assignments.map((item) => item.role)).toEqual(['verify'])
    expect(view.assignments.every((item) => item.writes !== true)).toBe(true)
    expect(view.assignments[0]?.prompt).toContain('不改实现')
    expect(view.assignments[0]?.boundHead).toBe('abc123')
    const proposal = runtime.propose({ workflow: { defaultKind: 'bugfix', maxReworkRounds: 5 } })
    expect(proposal.options.some((option) => option.id === 'workflow-off')).toBe(true)
    runtime.confirm(proposal.id, 'apply')
    const after = runtime.view(created.ticketId ?? '')
    expect(after.ticket.workflow?.kind).toBe('verify')
    expect(after.ticket.workflow?.maxReworkRounds).toBe(2)
    expect(after.ticket.phase).toBe('open')
    expect(after.mandate.withdrawn).toBe(false)
    expect(after.assignments[0]?.status).toBe('running')
    const next = await baseRequest(runtime, 'verify-2', { head: 'def456' })
    expect(runtime.view(next.ticketId ?? '').ticket.workflow?.kind).toBe('bugfix')
    runtime.revert(1)
    const restored = await baseRequest(runtime, 'verify-3', { phases: ['design'] })
    expect(runtime.view(restored.ticketId ?? '').ticket.workflow).toBeUndefined()
  })

  it('keeps pause, duplicate callbacks, and restart behavior', async () => {
    const runtime = use(openRuntime({ autoDrain: false }))
    runtime.pause()
    const paused = await baseRequest(runtime, 'pause-workflow', { workflow: 'feature' })
    expect(paused.paused).toBe(true)
    expect(runtime.adapter.calls).toHaveLength(0)
    const openedIds = await runtime.resume()
    await runtime.drain()
    const pausedTicket = openedIds[0] ?? ''
    const assignment = runtime.view(pausedTicket).assignments[0] as Assignment
    expect(assignment.status).toBe('running')
    const event = done(assignment, 'once')
    const first = await runtime.callback(event)
    const second = await runtime.callback({ ...event, route: 'fallback' })
    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(runtime.view(pausedTicket).assignments[0]?.status).toBe('claimed')

    const restart = use(openRuntime({ autoDrain: false }))
    const created = await baseRequest(restart, 'restart-workflow', { workflow: 'feature' })
    const launch = restart.store.effects().find((effect) => effect.kind === 'launch')
    if (!launch) throw new Error('missing launch')
    launch.status = 'running'
    restart.store.atomic(() => restart.store.writeEffect(launch))
    const dir = restart.store.dir
    restart.close()
    opened.pop()
    const restarted = use(openRuntime({ dir, autoDrain: false }))
    await restarted.drain()
    const recovered = restarted.view(created.ticketId ?? '')
    expect(recovered.assignments[0]?.block?.code).toBe('restart-unknown')
    expect(recovered.assignments.filter((item) => item.status === 'held').map((item) => item.stepId)).toEqual(['implement', 'verify'])
    expect(restarted.adapter.calls.filter((call) => call.op === 'launch')).toHaveLength(0)
  })
})
