import { stableId } from '../core/ids.js'
import type { Preference, PreferencePatch, Proposal } from '../core/model.js'
import { COST } from '../core/model.js'
import { UserError } from '../core/errors.js'

export function applyPatch(current: Preference, patch: PreferencePatch, at: string, note: string): Preference {
  return {
    ...current,
    ...patch,
    weights: patch.weights ?? current.weights,
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
  options.push({
    id: 'keep',
    title: '先不改',
    impact: '继续用当前版本，不写新配置。',
    patch: {},
  })
  const recommendation = changes.executeSubstitutes?.length
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
  if (parts.length === 0) parts.push('没有字段变化')
  return parts.join('。') + '。本地预算不是供应商账单。额度未知时不会编造剩余。'
}
