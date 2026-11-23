import type { AgentKind } from '../core/model.js'

/**
 * Consumer view of BotAsCollie v1.
 * Frozen at Phoobobo/grokbot-bridge-herdr ae859908ed07684997c786d1744e5f724f087259
 * (parent bbdfc4bbaece3ddafa3a9363b1d0f43b230aa5a6).
 * The bac binary is not implemented. This profile does not probe a machine.
 */
export const BAC_V1_COMMIT = 'ae859908ed07684997c786d1744e5f724f087259'
export const BAC_V1_PARENT = 'bbdfc4bbaece3ddafa3a9363b1d0f43b230aa5a6'

export interface CapabilityProfile {
  id: string
  simulated: boolean
  /** The bac process itself is not shipped. Consumer argv is ready; live E2E is not. */
  runtimeImplemented: false
  version: 1
  revision: string
  launchKinds: readonly ('codex' | 'grok')[]
  handover: boolean
  send: boolean
  modelField: false
  callbackCarriesTerminalOutput: false
  callbackPersistentRetry: false
  callbackEventId: true
  directHcControl: false
}

export const BAC_V1: CapabilityProfile = {
  id: 'bac-v1',
  simulated: false,
  runtimeImplemented: false,
  version: 1,
  revision: BAC_V1_COMMIT,
  launchKinds: ['codex', 'grok'],
  handover: true,
  send: true,
  modelField: false,
  callbackCarriesTerminalOutput: false,
  callbackPersistentRetry: false,
  callbackEventId: true,
  directHcControl: false,
}

export function launchRequirement(kind: AgentKind | string): string {
  return `bac.launch.kind=${kind}`
}

export type KindSupport = 'rejected' | 'unknown'

export function classifyLaunchKind(kind: string | undefined):
  | { ok: true; kind: 'codex' | 'grok' }
  | { ok: false; code: 'kind_required' }
  | { ok: false; code: 'kind_unsupported'; kind: string; kindSupport: KindSupport } {
  if (!kind) return { ok: false, code: 'kind_required' }
  if (kind === 'codex' || kind === 'grok') return { ok: true, kind }
  if (kind === 'pi' || kind === 'antigravity') {
    return { ok: false, code: 'kind_unsupported', kind, kindSupport: 'rejected' }
  }
  return { ok: false, code: 'kind_unsupported', kind, kindSupport: 'unknown' }
}
