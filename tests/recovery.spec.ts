import { afterEach, describe, expect, it } from 'vitest'
import type { EffectRow } from '../src/core/model.js'
import { baseRequest, clockAt, openRuntime, stock } from './helpers.js'
import { exampleSnapshot } from '../src/demo.js'
import type { Runtime } from '../src/runtime.js'

const opened: Runtime[] = []
afterEach(() => {
  for (const runtime of opened) runtime.close()
  opened.length = 0
})

describe('recovery, pause, timeout', () => {
  it('does not retry a send that timed out without a result', async () => {
    const runtime = openRuntime({ profile: stock, script: { send: 'unknown-timeout' } })
    opened.push(runtime)
    const created = await runtime.takeover(exampleSnapshot())
    const openItem = runtime.view(created.ticketId).assignments.find((item) => item.itemKey === 'open-1')
    expect(openItem?.status).toBe('unknown')
    expect(openItem?.block?.code).toBe('send-timeout-unknown')
    const sends = runtime.adapter.calls.filter((call) => call.op === 'send')
    await runtime.drain()
    expect(runtime.adapter.calls.filter((call) => call.op === 'send')).toHaveLength(sends.length)
    expect(sends).toHaveLength(1)
  })

  it('does not resume an in-flight launch after a restart', async () => {
    const clock = clockAt()
    const first = openRuntime({ autoDrain: false, clock })
    const dir = first.store.dir
    const created = await first.request({
      actor: 'grok-bot',
      text: '重启',
      scope: '范围',
      acceptance: ['tests'],
      acceptancePath: 'harness',
      phases: ['design'],
      requestId: 'restart-1',
      channel: 'grok-bot',
      repo: '/work/example-repo',
    })
    expect(created.ticketId).toBeTruthy()
    const launch = first.store.effects().find((effect) => effect.kind === 'launch') as EffectRow
    launch.status = 'running'
    launch.attempts = 1
    first.store.atomic(() => first.store.writeEffect(launch))
    first.close()
    const second = openRuntime({ dir, autoDrain: false, clock })
    opened.push(second)
    await second.drain()
    expect(second.adapter.calls.filter((call) => call.op === 'launch')).toHaveLength(0)
    expect(second.adapter.calls.filter((call) => call.op === 'status')).toHaveLength(1)
    const assignment = second.view(created.ticketId ?? '').assignments[0]
    expect(assignment?.status).toBe('unknown')
    expect(assignment?.block?.code).toBe('restart-unknown')
  })

  it('holds launches while paused and continues after resume', async () => {
    const runtime = openRuntime({ profile: stock })
    opened.push(runtime)
    runtime.pause()
    const created = await baseRequest(runtime, 'pause-1', { phases: ['design'] })
    expect(runtime.adapter.calls).toHaveLength(0)
    expect(created.paused).toBe(true)
    await runtime.resume()
    expect(runtime.adapter.calls.some((call) => call.op === 'launch' && call.argv.includes('codex'))).toBe(true)
  })

  it('reports a stuck running assignment without sending again', async () => {
    const clock = clockAt()
    const runtime = openRuntime({ clock, stuckAfterMs: 0 })
    opened.push(runtime)
    const created = await baseRequest(runtime, 'stuck-1', { phases: ['design'] })
    const before = runtime.adapter.calls.length
    clock.advance(1)
    await runtime.tick()
    expect(runtime.view(created.ticketId ?? '').assignments[0]?.attention).toBe('stuck')
    expect(runtime.adapter.calls.filter((call) => call.op === 'launch')).toHaveLength(1)
    expect(runtime.adapter.calls.length).toBe(before)
    expect(runtime.inbox().some((item) => item.text.includes('没有自动重发'))).toBe(true)
  })

  it('stops a launched assignment on cancel and does not stop an unknown one', async () => {
    const runtime = openRuntime()
    opened.push(runtime)
    const created = await baseRequest(runtime, 'cancel-1', { phases: ['design'] })
    await runtime.cancel(created.ticketId ?? '', '不做了')
    expect(runtime.adapter.calls.some((call) => call.op === 'stop')).toBe(true)
    expect(runtime.view(created.ticketId ?? '').mandate.withdrawn).toBe(true)

    const unknown = openRuntime({ script: { launch: 'unknown-timeout' } })
    opened.push(unknown)
    const second = await baseRequest(unknown, 'cancel-unknown', { phases: ['design'] })
    const stops = unknown.adapter.calls.filter((call) => call.op === 'stop').length
    await unknown.cancel(second.ticketId ?? '', '结果未知时取消')
    expect(unknown.adapter.calls.filter((call) => call.op === 'stop')).toHaveLength(stops)
  })
})
