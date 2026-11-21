import type { AgentKind } from '../core/model.js'

/**
 * What gbb 0.3.3 actually does, read from
 * Phoobobo/grokbot-bridge-herdr @ bbdfc4bbaece3ddafa3a9363b1d0f43b230aa5a6.
 * This is not a live probe of the operator's machine.
 */
export interface CapabilityProfile {
  id: string
  /** True when this profile pretends an upstream patch already shipped. */
  simulated: boolean
  version: string
  revision: string
  launchKinds: readonly AgentKind[]
  handover: boolean
  send: boolean
  /** hc ls/get do not carry a model field. Codex model text is a screen scrape, and only when kind is codex. */
  modelField: false
  callbackCarriesTerminalOutput: false
  callbackPersistentRetry: false
  callbackEventId: false
  /** gbb itself sets herdr.space, herdr.tab, grokbot=managed, and gbb_task. super-bot does not clear them. */
  preservesHerdrMarkers: true
  directHcControl: false
}

export const GBB_033_REVISION = 'bbdfc4bbaece3ddafa3a9363b1d0f43b230aa5a6'

/** Stock gbb 0.3.3. `bin/gbb` rejects `--kind` other than grok or codex. */
export const GBB_033: CapabilityProfile = {
  id: 'gbb-0.3.3',
  simulated: false,
  version: '0.3.3',
  revision: GBB_033_REVISION,
  launchKinds: ['grok', 'codex'],
  handover: true,
  send: true,
  modelField: false,
  callbackCarriesTerminalOutput: false,
  callbackPersistentRetry: false,
  callbackEventId: false,
  preservesHerdrMarkers: true,
  directHcControl: false,
}

/**
 * Simulated contract for tests and `sbot demo`. It is not gbb 0.3.3.
 * A real pi launch still needs the patch in docs/gbb/MINIMAL-PATCH.md, and a
 * program that reports OSC 7501, which this draft has not observed for pi.
 */
export const GBB_LAUNCH_KIND_V1_SIMULATED: CapabilityProfile = {
  ...GBB_033,
  id: 'gbb-launch-kind-v1-simulated',
  simulated: true,
  version: '0.3.3+launch-kind-v1',
  launchKinds: ['grok', 'codex', 'pi', 'antigravity'],
}

export function launchRequirement(kind: AgentKind): string {
  return `gbb.launch.kind=${kind}`
}
