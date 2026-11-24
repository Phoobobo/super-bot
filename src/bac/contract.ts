import type { AgentKind } from '../core/model.js'

/**
 * Consumer view of BotAsCollie v1.
 * Pinned to archive 10e1d2b7ce2d7bee71286b0a1d0672db4a551202.
 * commands.json matches the earlier freeze ae859908ed07684997c786d1744e5f724f087259.
 * The candidate says the runtime is implemented and not published. This profile does not launch it.
 */
export const BAC_V1_COMMIT = '10e1d2b7ce2d7bee71286b0a1d0672db4a551202'
export const BAC_V1_PARENT = 'ae859908ed07684997c786d1744e5f724f087259'

export interface CapabilityProfile {
  id: string
  simulated: boolean
  /** Candidate identity says the runtime exists. It is not published, and this profile does not run it. */
  runtimeImplemented: true
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
  runtimeImplemented: true,
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
