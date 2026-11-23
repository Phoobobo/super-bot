import { defaultWeights } from './defaults.js'
import { stableId } from '../core/ids.js'
import type { Preference, PreferencePatch, Proposal } from '../core/model.js'
import { COST } from '../core/model.js'
import { UserError } from '../core/errors.js'
import { workflowPolicy } from '../workflow/protocol.js'

export function applyPatch(current: Preference, patch: PreferencePatch, at: string, note: string): Preference {
  const { workflow: workflowPatch, ...rest } = patch
  return {
    ...current,
    ...rest,
    weights: patch.weights ?? current.weights,
    workflow: workflowPatch ? { ...workflowPolicy(current), ...workflowPatch } : workflowPolicy(current),
    version: current.version + 1,
    at,
    note,
  }
}

export function buildProposal(current: Preference, changes: PreferencePatch, at: string): Proposal {
  const impact = describePatch(current, changes)
  const options: Proposal['options'] = [
    {
      id: 'apply',
      title: '按这次调整保存',
      impact,
      patch: changes,
    },
  ]
  if (changes.intensity === 'high') {
    const budget = changes.budget ?? current.budget
    const need = COST.high * 3
    if (budget < need) {
      options.push({
        id: 'safer',
        title: '高强度保留，把本地预算补到三阶段',
        impact: `高强度每阶段记 ${COST.high}。按现在的预算 ${budget}，设计、执行、验证走不完。补到 ${need} 后三阶段都能起步。`,
        patch: { ...changes, budget: need },
      })
    }
  }
  if (changes.executeSubstitutes && changes.executeSubstitutes.length > 0) {
    options.push({
      id: 'substitutes-only',
      title: '只确认执行替代，其它保持不变',
      impact: `pi 不能 launch 时可以改用 ${changes.executeSubstitutes.join('、')}。设计/验证的抽样和预算不动。`,
      patch: { executeSubstitutes: changes.executeSubstitutes },
    })
  }
  if (changes.workflow?.defaultKind && changes.workflow.defaultKind !== 'off') {
    options.push({
      id: 'workflow-off',
      title: '流程保持关闭',
      impact: '默认仍按原来的阶段列表派工。代理偏好不动。',
      patch: {},
    })
  }
  options.push({
    id: 'keep',
    title: '先不改',
    impact: '继续用当前版本，不写新配置。',
    patch: {},
  })
  const recommendation = changes.workflow?.defaultKind && changes.workflow.defaultKind !== 'off'
    ? `建议把新工单的默认流程设为 ${changes.workflow.defaultKind}。这不改变设计 codex、执行 pi、验证 codex，也不取消已经在跑的工单。${impact}`
    : changes.executeSubstitutes?.length
    ? `pi 在 gbb 0.3.3 上不能新开。若你确认替代，之后的执行阶段会标明 user-approved-substitute，而不会悄悄换成 codex。${impact}`
    : `建议先看影响再确认。${impact}`
  return {
    id: stableId('prp', [String(current.version), at, JSON.stringify(changes)]),
    baseVersion: current.version,
    at,
    changes,
    recommendation,
    options,
    status: 'open',
  }
}

export function roleRecommendation(current: Preference, at: string): Proposal {
  const raised = defaultWeights()
  raised.design = [
    { kind: 'codex', weight: 74 },
    { kind: 'grok', weight: 20 },
    { kind: 'antigravity', weight: 6 },
  ]
  return {
    id: stableId('prp', ['roles', String(current.version), at]),
    baseVersion: current.version,
    at,
    changes: {},
    recommendation:
      '建议保持设计与验证以 codex 为主，并给 grok、antigravity 一小段抽样。执行继续只选 pi。gbb 0.3.3 不能新开 pi 或 antigravity。只有确认 substitutes-only 之后，pi 不能 launch 时才会标 user-approved-substitute，不会悄悄换成 codex。',
    options: [
      {
        id: 'keep',
        title: '保持当前角色',
        impact: '设计与验证仍是 codex 94、grok 3、antigravity 3。执行只有 pi。',
        patch: {},
      },
      {
        id: 'more-grok',
        title: '提高设计阶段的 grok 抽样',
        impact: 'codex 仍是首选，权重 74。grok 20，antigravity 6。执行仍只有 pi。',
        patch: { weights: raised },
      },
      {
        id: 'substitutes-only',
        title: '仅在 pi 不能 launch 时允许 codex',
        impact: '确认后才会写入。派工会标 user-approved-substitute，而不是默认改派。',
        patch: { executeSubstitutes: ['codex'] },
      },
    ],
    status: 'open',
  }
}

export function optionOf(proposal: Proposal, optionId: string): Proposal['options'][number] {
  const found = proposal.options.find((option) => option.id === optionId)
  if (!found) throw new UserError('proposal-option', `没有选项 ${optionId}`)
  return found
}

function describePatch(current: Preference, changes: PreferencePatch): string {
  const parts: string[] = []
  if (changes.intensity && changes.intensity !== current.intensity) {
    parts.push(`强度 ${current.intensity} → ${changes.intensity}（每阶段 ${COST[current.intensity]} → ${COST[changes.intensity]}）`)
  }
  if (changes.budget !== undefined && changes.budget !== current.budget) {
    parts.push(`本地预算 ${current.budget} → ${changes.budget}`)
  }
  if (changes.executeSubstitutes) {
    parts.push(
      changes.executeSubstitutes.length
        ? `执行替代设为 ${changes.executeSubstitutes.join('、')}，仅在 pi 不能 launch 时使用`
        : '清掉执行替代',
    )
  }
  if (changes.unknownQuota && changes.unknownQuota !== current.unknownQuota) {
    parts.push(`未知额度策略 ${current.unknownQuota} → ${changes.unknownQuota}`)
  }
  if (changes.authorizedKinds) parts.push(`授权候选改为 ${changes.authorizedKinds.join('、')}`)
  if (changes.workflow?.defaultKind && changes.workflow.defaultKind !== workflowPolicy(current).defaultKind) {
    parts.push(`默认流程 ${workflowPolicy(current).defaultKind} → ${changes.workflow.defaultKind}`)
  }
  if (changes.workflow?.maxReworkRounds !== undefined && changes.workflow.maxReworkRounds !== workflowPolicy(current).maxReworkRounds) {
    parts.push(`验收失败后的返工上限 ${workflowPolicy(current).maxReworkRounds} → ${changes.workflow.maxReworkRounds}`)
  }
  if (parts.length === 0) parts.push('没有字段变化')
  return parts.join('。') + '。本地预算不是供应商账单。额度未知时不会编造剩余。'
}
