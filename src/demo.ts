import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BAC_V1 } from './bac/contract.js'
import { callbackEventId } from './bac/callback.js'
import type { GbbEvent } from './core/model.js'
import { Runtime } from './runtime.js'
import type { TakeoverSnapshot } from './takeover/snapshot.js'

export interface DemoReport {
  simulated: true
  realE2E: false
  scenarios: { name: string; ok: boolean; detail: string }[]
}

/** Three local scenarios on the fake adapter. Nothing here talks to a gbb on a user machine. */
export async function runDemos(root?: string): Promise<DemoReport> {
  const dir = root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-demo-'))
  const scenarios = [
    await newRequest(path.join(dir, 'new')),
    await takeover(path.join(dir, 'takeover')),
    await preference(path.join(dir, 'preference')),
    await workflowFeature(path.join(dir, 'workflow')),
  ]
  return { simulated: true, realE2E: false, scenarios }
}

async function newRequest(dir: string): Promise<DemoReport['scenarios'][number]> {
  const runtime = new Runtime({ dir, adapter: 'fake', profile: BAC_V1 })
  try {
    const created = await runtime.request({
      actor: 'grok-bot',
      text: '给示例仓库补一个健康检查。$(echo pwned)',
      scope: '只改示例仓库里的健康检查',
      acceptance: ['tests'],
      acceptancePath: '由 bot 运行检查后提交 harness 证据，不采用代理自报',
      phases: ['design', 'execute', 'verify'],
      requestId: 'demo-new-1',
      channel: 'grok-bot',
      repo: '/work/example-repo',
    })
    if (!created.ticketId) return fail('new-request', '没有工单')
    let view = runtime.view(created.ticketId)
    const design = view.assignments.find((item) => item.role === 'design')
    if (!design || design.status !== 'running' || design.plan?.kind !== 'codex') {
      return fail('new-request', `设计阶段是 ${design?.status}/${design?.plan?.kind}`)
    }
    await runtime.callback(doneEvent(design.gbbTaskId ?? '', 'demo-design'))
    await runtime.evidence(design.id, 'harness', [{ id: 'role:design', ok: true }])
    view = runtime.view(created.ticketId)
    const execute = view.assignments.find((item) => item.role === 'execute')
    if (execute?.block?.code !== 'kind_unsupported' || execute.block.kindSupport !== 'rejected') {
      return fail('new-request', `执行阶段是 ${execute?.status}/${execute?.block?.code}`)
    }
    if (runtime.adapter.calls.some((call) => call.argv.includes('--kind') && call.argv.includes('codex') && call.argv.includes('pi'))) {
      return fail('new-request', 'pi 被改写成了别的 kind')
    }
    if (view.ticket.phase === 'ended') return fail('new-request', 'pi 被拒绝后工单不应结束')
    return { name: 'new-request', ok: true, detail: 'design 可以派 codex。execute 的 pi 是 kind_unsupported，kind_support rejected，没有改写。realE2E false。' }
  } finally {
    runtime.close()
  }
}

async function takeover(dir: string): Promise<DemoReport['scenarios'][number]> {
  const runtime = new Runtime({ dir, adapter: 'fake', profile: BAC_V1 })
  try {
    const created = await runtime.takeover(exampleSnapshot())
    const view = runtime.view(created.ticketId)
    const skipped = view.assignments.find((item) => item.itemKey === 'done-1')
    const open = view.assignments.find((item) => item.itemKey === 'open-1')
    const sent = runtime.adapter.calls.filter((call) => call.op === 'send')
    const launched = runtime.adapter.calls.filter((call) => call.op === 'launch')
    if (skipped?.status !== 'skipped') return fail('takeover', '已完成项被再次派工')
    if (open?.status !== 'running') return fail('takeover', `未完成项状态 ${open?.status}`)
    if (launched.length) return fail('takeover', '接管不该新 launch')
    if (!sent.length) return fail('takeover', '没有续办 send')
    if (view.ticket.unknownItems.length !== 1) return fail('takeover', '未知项丢失')
    return { name: 'takeover', ok: true, detail: view.messages.map((item) => item.text).join(' ') }
  } finally {
    runtime.close()
  }
}

async function preference(dir: string): Promise<DemoReport['scenarios'][number]> {
  const runtime = new Runtime({ dir, adapter: 'fake', profile: BAC_V1 })
  try {
    const blocked = await runtime.request({
      actor: 'grok-bot',
      text: '只执行',
      scope: '执行阶段',
      acceptance: ['tests'],
      acceptancePath: 'harness',
      phases: ['execute'],
      requestId: 'demo-pref-1',
      channel: 'grok-bot',
      repo: '/work/example-repo',
    })
    const before = blocked.ticketId ? runtime.view(blocked.ticketId).assignments[0] : undefined
    if (before?.block?.code !== 'kind_unsupported' || before.block.kindSupport !== 'rejected') {
      return fail('preference', '执行阶段应拒绝 pi')
    }
    const proposal = runtime.propose({ executeSubstitutes: ['codex'] })
    runtime.confirm(proposal.id, 'apply')
    const after = await runtime.request({
      actor: 'grok-bot',
      text: '只执行，已批准替代',
      scope: '执行阶段',
      acceptance: ['tests'],
      acceptancePath: 'harness',
      phases: ['execute'],
      requestId: 'demo-pref-2',
      channel: 'grok-bot',
      repo: '/work/example-repo',
    })
    const next = after.ticketId ? runtime.view(after.ticketId).assignments[0] : undefined
    if (!next?.plan || next.plan.kind !== 'pi' || next.block?.code !== 'kind_unsupported') {
      return fail('preference', '确认替代后仍不得把 pi 改写成 codex')
    }
    if (runtime.adapter.calls.some((call) => call.op === 'launch' && call.argv[call.argv.indexOf('--kind') + 1] === 'codex')) {
      return fail('preference', 'pi 派工发出了 codex launch')
    }
    runtime.revert(1)
    const reverted = await runtime.request({
      actor: 'grok-bot',
      text: '撤回之后',
      scope: '执行阶段',
      acceptance: ['tests'],
      acceptancePath: 'harness',
      phases: ['execute'],
      requestId: 'demo-pref-3',
      channel: 'grok-bot',
      repo: '/work/example-repo',
    })
    const third = reverted.ticketId ? runtime.view(reverted.ticketId).assignments[0] : undefined
    if (third?.block?.code !== 'kind_unsupported') return fail('preference', '撤回后的执行阶段不再是拒绝 pi')
    return { name: 'preference', ok: true, detail: proposal.recommendation }
  } finally {
    runtime.close()
  }
}

async function workflowFeature(dir: string): Promise<DemoReport['scenarios'][number]> {
  const runtime = new Runtime({ dir, adapter: 'fake', profile: BAC_V1 })
  try {
    const created = await runtime.request({
      actor: 'grok-bot',
      text: '按 pstack feature 走一遍只读设计、实现和独立验收',
      scope: '只改示例仓库里的健康检查',
      acceptance: ['tests'],
      acceptancePath: 'bot 提交带 head 的 harness 证据',
      phases: ['design', 'execute', 'verify'],
      requestId: 'demo-workflow-1',
      channel: 'grok-bot',
      repo: '/work/example-repo',
      workflow: 'feature',
    })
    if (!created.ticketId) return fail('workflow', '没有工单')
    const trace = runtime.view(created.ticketId).assignments.find((item) => item.stepId === 'trace')
    if (!trace || trace.status !== 'running') return fail('workflow', `trace 状态是 ${trace?.status}`)
    await runtime.callback(doneEvent(trace.gbbTaskId ?? '', 'demo-trace'))
    await runtime.evidence(trace.id, 'harness', [], 'grok-bot', { head: 'aaa111', command: 'npm test', output: 'design notes' })
    const view = runtime.view(created.ticketId)
    const implement = view.assignments.find((item) => item.stepId === 'implement')
    if (implement?.block?.code !== 'kind_unsupported' || implement.block.kindSupport !== 'rejected') {
      return fail('workflow', `implement 是 ${implement?.status}/${implement?.block?.code}`)
    }
    if (runtime.adapter.calls.some((call) => call.op === 'launch' && call.argv.includes('pi'))) {
      return fail('workflow', '拒绝的 pi 仍然被 launch')
    }
    if (view.ticket.phase === 'ended') return fail('workflow', '实现步骤被拒绝后工单不应结束')
    return {
      name: 'workflow',
      ok: true,
      detail: 'feature 的 trace 可以走 codex。implement 的 pi 被 kind_unsupported 拒绝，没有改写。fake adapter，realE2E false。',
    }
  } finally {
    runtime.close()
  }
}

function doneEvent(taskId: string, label: string): GbbEvent {
  const generation = generationFrom(`${taskId}|${label}`)
  const event = 'agent_status'
  const status = 'done'
  const paneId = 't9'
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
    owner: 'grok-bot',
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

export function exampleSnapshot(): TakeoverSnapshot {
  return {
    schema: 'superbot.takeover.v1',
    source: { adapter: 'bac', command: 'status', observedAt: '2026-01-01T00:00:00.000Z' },
    identity: {
      paneId: 'term-example',
      taskId: 'task-example',
      backend: 'hc',
      origin: 'existing',
      owner: 'grok-bot',
      kind: { status: 'known', value: 'codex', source: 'operator-snapshot', observedAt: '2026-01-01T00:00:00.000Z' },
      model: { status: 'unknown', source: 'hc-get-has-no-model-field', observedAt: '2026-01-01T00:00:00.000Z' },
      labelsConsistent: false,
      labelNote: 'gbb list 的标签和登记不一致，快照不采用标签上的任务名',
    },
    authorization: {
      actor: 'grok-bot',
      scope: '只继续快照里的未完成项',
      allowedToContinue: true,
      acceptance: ['tests'],
    },
    work: {
      done: [{ key: 'done-1', title: '已经写过的接口' }],
      open: [
        { key: 'done-1', title: '已经写过的接口', role: 'execute' },
        { key: 'open-1', title: '补上剩下的分支。不要执行 $(echo pwned)', role: 'execute' },
      ],
      unknown: [{ note: '不清楚旧会话有没有跑过发布' }],
    },
    acceptancePath: 'bot 核对 diff 和测试输出后提交 harness 证据',
    repo: '/work/example-repo',
    channel: 'grok-bot',
  }
}

function fail(name: string, detail: string): DemoReport['scenarios'][number] {
  return { name, ok: false, detail }
}
