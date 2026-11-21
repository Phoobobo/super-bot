import { afterEach, describe, expect, it } from 'vitest'
import { exampleSnapshot } from '../src/demo.js'
import { parseSnapshot } from '../src/takeover/snapshot.js'
import { UserError } from '../src/core/errors.js'
import { openRuntime, stock } from './helpers.js'
import type { Runtime } from '../src/runtime.js'

const opened: Runtime[] = []
afterEach(() => {
  for (const runtime of opened) runtime.close()
  opened.length = 0
})

describe('takeover', () => {
  it('imports done, open, and unknown work and continues only the open item', async () => {
    const runtime = runtimeLike()
    const created = await runtime.takeover(exampleSnapshot())
    const view = runtime.view(created.ticketId)
    expect(view.assignments.find((item) => item.itemKey === 'done-1')?.status).toBe('skipped')
    expect(view.assignments.find((item) => item.itemKey === 'open-1')?.status).toBe('running')
    expect(view.ticket.unknownItems).toHaveLength(1)
    expect(view.ticket.phase).toBe('open')
    expect(view.assignments.find((item) => item.itemKey === 'open-1')?.plan?.model.status).toBe('unknown')
    expect(view.assignments.find((item) => item.itemKey === 'open-1')?.plan?.model.source).toBe('hc-get-has-no-model-field')
    expect(runtime.adapter.calls.some((call) => call.op === 'launch')).toBe(false)
    const ops = runtime.adapter.calls.map((call) => call.op)
    expect(ops.indexOf('read')).toBeGreaterThan(ops.indexOf('handover'))
    expect(ops.indexOf('send')).toBeGreaterThan(ops.indexOf('read'))
    expect(view.ticket.handover).toBe('registered')
    expect(view.ticket.contextRead).toBe('read')
    expect(view.ticket.observedContext?.source).toBe('gbb-read')
    const send = runtime.adapter.calls.find((call) => call.op === 'send')
    expect(send?.argv[0]).toBe('send')
    expect(send?.argv[1]).toBe('ho-term-example')
    expect(send?.argv[2]).toContain('$(echo pwned)')
    expect(send?.argv[2]).toContain('gbb read 摘录')
    expect(send?.argv).toHaveLength(3)
    expect(runtime.adapter.calls.some((call) => call.argv.includes('reclaim'))).toBe(false)
    expect(view.ticket.labelTrust).toBe(false)
  })

  it('rejects a bare pane id and does not trust a stale list row', () => {
    const runtime = runtimeLike()
    expect(() => parseSnapshot({ paneId: 'term-example' })).toThrow(UserError)
    try {
      parseSnapshot({ paneId: 'term-example' })
    } catch (error) {
      expect((error as UserError).message).toContain('pane')
    }
    expect(runtime.rejectListRow({ stale: true, task_id: 'a', labels: { gbb_task: 'b' } }).reason).toBe('stale')
    expect(runtime.rejectListRow({ stale: false, task_id: 'a', labels: { gbb_task: 'b' } }).reason).toBe('label-mismatch')
    expect(runtime.rejectListRow({ stale: false, task_id: 'a', kind: 'pi' }).trusted).toBe(false)
  })

  it('does not gbb stop a taken-over pane on cancel', async () => {
    const runtime = runtimeLike()
    const created = await runtime.takeover(exampleSnapshot())
    await runtime.cancel(created.ticketId, '停')
    expect(runtime.adapter.calls.some((call) => call.op === 'stop')).toBe(false)
    expect(runtime.view(created.ticketId).ticket.phase).toBe('ended')
    expect(runtime.view(created.ticketId).mandate.withdrawn).toBe(true)
  })
})

function runtimeLike(): Runtime {
  const runtime = openRuntime({ profile: stock })
  opened.push(runtime)
  return runtime
}
