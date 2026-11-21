import type { Role, WorkflowKind, WorkflowPolicy } from '../core/model.js'

/** Source playbooks: cursor/plugins e58dd043 feature.md and bug-fix.md. Not a second scheduler. */
export const PSTACK_SOURCE = {
  repository: 'https://github.com/cursor/plugins',
  path: 'pstack',
  commit: 'e58dd043600587dbaf58ba315e7f2b38373eeb43',
  version: '0.15.44',
  license: 'MIT',
  copyright: 'Copyright (c) 2026 Lauren Tan',
} as const

export const DEFAULT_WORKFLOW: WorkflowPolicy = { defaultKind: 'off', maxReworkRounds: 2 }

export interface WorkflowStep {
  id: string
  role: Role
  title: string
  writes: boolean
  readOnly: boolean
  dependsOn: string[]
}

export function workflowPolicy(preference: { workflow?: Partial<WorkflowPolicy> | undefined }): WorkflowPolicy {
  const raw = preference.workflow
  const kind = raw?.defaultKind
  const defaultKind = kind === 'feature' || kind === 'bugfix' || kind === 'verify' || kind === 'off' ? kind : DEFAULT_WORKFLOW.defaultKind
  const rounds = raw?.maxReworkRounds
  const maxReworkRounds = Number.isInteger(rounds) && (rounds as number) >= 0 && (rounds as number) <= 5 ? (rounds as number) : DEFAULT_WORKFLOW.maxReworkRounds
  return { defaultKind, maxReworkRounds }
}

export function isWorkflowKind(value: string | undefined): value is WorkflowKind {
  return value === 'feature' || value === 'bugfix' || value === 'verify'
}

/** Fixed step order. Shared ticket state stays serial under one owner. */
export function workflowSteps(kind: WorkflowKind): WorkflowStep[] {
  if (kind === 'feature') {
    return [
      { id: 'trace', role: 'design', title: '追踪并定下数据形状', writes: false, readOnly: true, dependsOn: [] },
      { id: 'implement', role: 'execute', title: '按已定形状实现', writes: true, readOnly: false, dependsOn: ['trace'] },
      { id: 'verify', role: 'verify', title: '独立验收', writes: false, readOnly: true, dependsOn: ['implement'] },
    ]
  }
  if (kind === 'bugfix') {
    return [
      { id: 'reproduce', role: 'design', title: '复现并记下失败命令', writes: false, readOnly: true, dependsOn: [] },
      { id: 'fix', role: 'execute', title: '最小修复', writes: true, readOnly: false, dependsOn: ['reproduce'] },
      { id: 'verify', role: 'verify', title: '用同一复现命令验收', writes: false, readOnly: true, dependsOn: ['fix'] },
    ]
  }
  return [{ id: 'verify', role: 'verify', title: '只读独立验收', writes: false, readOnly: true, dependsOn: [] }]
}

export function workflowBrief(input: {
  kind: WorkflowKind
  step: WorkflowStep
  owner: string
  scope: string
  acceptance: string[]
  boundHead?: string
  reproCommand?: string
}): string {
  const write = input.step.writes ? '这一步可以改仓库，并且是该工单上唯一的写入者。' : '这一步只读，不改实现，不接管别人的 diff。'
  const head = input.boundHead ? `验收必须对上 head ${input.boundHead}。旧 head 上的绿灯不能复用。` : '还没有可验收的 head。'
  const repro = input.kind === 'bugfix' && input.step.id === 'verify'
    ? `必须重跑复现命令：${input.reproCommand ?? '还没有记下复现命令'}。不要换成别的检查。`
    : 'kickoff 列出的验收项不能在中途追加。'
  return [
    `协议 pstack/${input.kind}。super-bot 仍是唯一调度，这一步不是第二个调度器。`,
    `owner：${input.owner}。耦合任务只有这一个 owner。`,
    `步骤 ${input.step.id}（${input.step.title}）。依赖：${input.step.dependsOn.join('、') || '无'}。`,
    `范围：${input.scope}`,
    write,
    `共享可变状态按步骤串行。独立只读步骤不并行写同一工单。`,
    `kickoff 验收：${input.acceptance.join('、')}。`,
    repro,
    head,
    '代理自报不算独立验收。设计默认 codex，执行默认 pi，验证默认 codex。pi 不能 launch 时停住，不改派。',
  ].join('\n')
}

export interface WorkflowJudgeInput {
  kind: WorkflowKind
  stepId: string
  producer: 'harness' | 'agent'
  claimOk: boolean
  checks: { id: string; ok: boolean }[]
  acceptance: string[]
  head?: string
  command?: string
  output?: string
  verifier?: string
  boundHead?: string
  reproCommand?: string
  reproOutput?: string
  implementerIds: string[]
}

export interface WorkflowJudgment {
  sufficient: boolean
  reason: string
  block?: { code: string; detail: string }
  recordHead?: string
  recordRepro?: { command: string; output: string }
  rework: boolean
}

export function judgeWorkflowEvidence(input: WorkflowJudgeInput): WorkflowJudgment {
  if (input.producer === 'agent') {
    return { sufficient: false, reason: 'agent-self-report', rework: false }
  }
  if (!input.claimOk) return { sufficient: false, reason: 'waiting-for-callback', rework: false }
  if (!input.head || !input.command || !input.output) {
    return { sufficient: false, reason: 'no-evidence', block: { code: 'no-evidence', detail: '验收要有 head、命令和实际输出' }, rework: false }
  }
  if (input.boundHead && input.head !== input.boundHead) {
    return {
      sufficient: false,
      reason: 'sha-stale',
      block: { code: 'sha-stale', detail: `证据 head ${input.head} 不是当前要求的 ${input.boundHead}` },
      rework: false,
    }
  }
  const failed = input.checks.some((check) => input.acceptance.includes(check.id) && !check.ok)
  if (input.stepId !== 'verify') {
    if (failed) {
      return { sufficient: false, reason: 'checks-failed', block: { code: 'evidence_rejected', detail: '这一步的 harness 检查没有通过' }, rework: false }
    }
    const recordRepro = input.kind === 'bugfix' && input.stepId === 'reproduce'
      ? { command: input.command, output: input.output }
      : undefined
    const recordHead = input.stepId === 'implement' || input.stepId === 'fix' ? input.head : undefined
    return { sufficient: true, reason: 'step-evidence', recordHead, recordRepro, rework: false }
  }
  if (input.implementerIds.includes(input.verifier ?? '')) {
    return {
      sufficient: false,
      reason: 'verifier-is-implementer',
      block: { code: 'verifier-is-implementer', detail: '实现方不能给自己做独立验收' },
      rework: false,
    }
  }
  if (!input.verifier) {
    return { sufficient: false, reason: 'verifier-missing', block: { code: 'verifier-missing', detail: '独立验收要写明验收身份' }, rework: false }
  }
  if (input.kind === 'bugfix') {
    if (!input.reproCommand || input.command !== input.reproCommand) {
      return {
        sufficient: false,
        reason: 'wrong-surface',
        block: { code: 'wrong-surface', detail: '验收必须重跑复现时记下的同一条命令' },
        rework: false,
      }
    }
    if (input.output === input.reproOutput) {
      return { sufficient: false, reason: 'no-progress', block: { code: 'no-progress', detail: '输出和失败的复现相同，没有进展' }, rework: false }
    }
  }
  const covered = input.acceptance.every((id) => input.checks.some((check) => check.id === id && check.ok))
  if (failed || !covered) {
    return {
      sufficient: false,
      reason: failed ? 'checks-failed' : 'checks-missing',
      block: { code: 'evidence_rejected', detail: 'kickoff 验收没有全部通过' },
      rework: true,
    }
  }
  return { sufficient: true, reason: 'harness-checks-passed', rework: false }
}
