import type { QuotaValue } from './core/model.js'
import type { RawObservation } from './observe.js'

/** A readable balance channel. The default channel reports that none is configured. */
export interface QuotaProvider {
  id: string
  read(nowIso: string): RawObservation<QuotaValue>
}

export function unconfiguredQuota(nowIso: string): RawObservation<QuotaValue> {
  return { status: 'unknown', origin: 'unknown', source: 'no-quota-channel', observedAt: nowIso }
}

/**
 * Operator-supplied numbers. They stay `config` even if the file claims to be an official observation.
 */
export function configQuota(text: string, nowIso: string): RawObservation<QuotaValue> {
  const parsed = JSON.parse(text) as { remaining?: unknown; limit?: unknown; observedAt?: unknown; freshUntil?: unknown }
  if (typeof parsed.remaining !== 'number' || !Number.isFinite(parsed.remaining)) {
    throw new Error('config quota needs a numeric remaining')
  }
  return {
    status: 'known',
    origin: 'config',
    value: { remaining: parsed.remaining, limit: typeof parsed.limit === 'number' ? parsed.limit : undefined },
    source: 'config:operator',
    observedAt: typeof parsed.observedAt === 'string' ? parsed.observedAt : nowIso,
    freshUntil: typeof parsed.freshUntil === 'string' ? parsed.freshUntil : undefined,
  }
}

export const unconfiguredProvider: QuotaProvider = {
  id: 'unconfigured',
  read: unconfiguredQuota,
}

/** Test double. `read` is called every time a role is planned. */
export function fixedQuota(raw: RawObservation<QuotaValue>): QuotaProvider {
  return { id: raw.source || 'fixed', read: () => raw }
}
