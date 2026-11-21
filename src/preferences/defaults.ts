import type { Preference, Role, Weight } from '../core/model.js'

/** Design and verify lean to codex. Execute is only pi. The small weights are exploration, not a fallback. */
export function defaultWeights(): Record<Role, Weight[]> {
  return {
    design: [
      { kind: 'codex', weight: 94 },
      { kind: 'grok', weight: 3 },
      { kind: 'antigravity', weight: 3 },
    ],
    verify: [
      { kind: 'codex', weight: 94 },
      { kind: 'grok', weight: 3 },
      { kind: 'antigravity', weight: 3 },
    ],
    execute: [{ kind: 'pi', weight: 100 }],
  }
}

export function initialPreference(at: string): Preference {
  return {
    version: 1,
    intensity: 'normal',
    budget: 20,
    authorizedKinds: ['codex', 'pi', 'grok', 'antigravity'],
    executeSubstitutes: [],
    weights: defaultWeights(),
    sampleSeed: 'super-bot-v1',
    unknownQuota: 'mark-and-proceed',
    acceptMode: 'explicit-only',
    allowedActors: ['grok-bot'],
    at,
    note: '初始偏好。额度通道未配置，未知额度只标记并允许首选角色。',
  }
}
