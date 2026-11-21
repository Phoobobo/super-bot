import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GBB_033, GBB_LAUNCH_KIND_V1_SIMULATED } from './gbb/contract.js'
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
  const scenarios = [await newRequest(path.join(dir, 'new')), await takeover(path.join(dir, 'takeover')), await preference(path.join(dir, 'preference'))]
  return { simulated: true, realE2E: false, scenarios }
}

async function newRequest(dir: string): Promise<DemoReport['scenarios'][number]> {
  const runtime = new Runtime({ dir, adapter: 'fake', profile: GBB_LAUNCH_KIND_V1_SIMULATED })
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
    for (const role of ['design', 'execute', 'verify'] as const) {
      const assignment = view.assignments.find((item) => item.role === role)
      if (!assignment) return fail('new-request', `缺少 ${role}`)
      if (assignment.status !== 'running') return fail('new-request', `${role} 状态是 ${assignment.status}`)
      await runtime.callback(doneEvent(assignment.gbbTaskId ?? '', `demo-${role}`))
      const checks = [{ id: `role:${role}`, ok: true }]
      if (role === 'verify') checks.push({ id: 'tests', ok: true })
      await runtime.evidence(assignment.id, 'harness', checks)
      view = runtime.view(created.ticketId)
    }
    const summary = view.messages.find((item) => item.purpose === 'summary')
    const kinds = view.assignments.map((item) => item.plan?.kind).join(',')
    if (view.ticket.phase !== 'ended' || !summary) return fail('new-request', '工单没有向 bot 汇总')
    if (kinds !== 'codex,pi,codex') return fail('new-request', `分工是 ${kinds}`)
    return { name: 'new-request', ok: true, detail: summary.text }
  } finally {
    runtime.close()
  }
}

async function takeover(dir: string): Promise<DemoReport['scenarios'][number]> {
  const runtime = new Runtime({ dir, adapter: 'fake', profile: GBB_033 })
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
  const runtime = new Runtime({ dir, adapter: 'fake', profile: GBB_033 })
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
    if (before?.block?.code !== 'capability') return fail('preference', '替换前应该因能力不足停下')
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
    if (next?.plan?.kind !== 'codex' || next.plan.sample.selection !== 'user-approved-substitute') {
      return fail('preference', '确认后的执行阶段没有使用已批准替代')
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
    if (third?.block?.code !== 'capability') return fail('preference', '撤回后仍在使用替代')
    return { name: 'preference', ok: true, detail: proposal.recommendation }
  } finally {
    runtime.close()
  }
}

function doneEvent(taskId: string, eventId: string): GbbEvent {
  return {
    source: 'grokbot-bridge-herdr',
    version: '0.3.3',
    event: 'agent_status',
    event_id: eventId,
    task_id: taskId,
    status: 'done',
    ts: '2026-01-01T00:00:00.000Z',
    owner: 'grok-bot',
    route: 'owner',
    claim: '我做完了',
  }
}

export function exampleSnapshot(): TakeoverSnapshot {
  return {
    schema: 'superbot.takeover.v1',
    source: { adapter: 'gbb', command: 'status', observedAt: '2026-01-01T00:00:00.000Z' },
    identity: {
      paneId: 'term-example',
      taskId: 'task-example',
      backend: 'hc',
      origin: 'existing',
      owner: 'grok-bot',
      kind: { status: 'known', value: 'pi', source: 'operator-snapshot', observedAt: '2026-01-01T00:00:00.000Z' },
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
