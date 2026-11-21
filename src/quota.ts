import type { QuotaValue } from './core/model.js'
import type { RawObservation } from './observe.js'

/** A readable balance channel. The default channel reports that none is configured. */
export interface QuotaProvider {
  id: string
  read(nowIso: string): RawObservation<QuotaValue>
}

export function unconfiguredQuota(nowIso: string): RawObservation<QuotaValue> {
  return { status: 'unknown', source: 'no-quota-channel', observedAt: nowIso }
}

export const unconfiguredProvider: QuotaProvider = {
  id: 'unconfigured',
  read: unconfiguredQuota,
}

/** Test double. `read` is called every time a role is planned. */
export function fixedQuota(raw: RawObservation<QuotaValue>): QuotaProvider {
  return { id: raw.source || 'fixed', read: () => raw }
}
