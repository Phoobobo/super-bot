import type { QuotaValue } from '../core/model.js'
import type { RawObservation } from '../observe.js'
import { unconfiguredQuota } from '../quota.js'
import { readCodexRateLimits, spawnCodexAppServer } from './codex-quota.js'
import { grokQuota } from './grok-quota.js'

/**
 * Named probes are explicit. The planner default stays the unconfigured channel.
 * Neither probe reads an auth file, and neither invents a remaining balance.
 */
export async function probeNamedQuota(name: string | undefined, nowIso: string): Promise<RawObservation<QuotaValue>> {
  if (name === 'codex') return readCodexRateLimits(spawnCodexAppServer(process.env.SUPERBOT_CODEX_BIN || 'codex'), nowIso)
  if (name === 'grok') return grokQuota(nowIso)
  return unconfiguredQuota(nowIso)
}
