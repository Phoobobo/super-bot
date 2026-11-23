/**
 * A fact we might not have. Usable numbers require status known, a source,
 * an observation time, and a freshUntil that is still ahead. Anything else
 * stays unknown, stale, or expired and must not be treated as a balance or a model id.
 */
/** observed: a live system reported it. config: an operator file said it. unknown: we do not have it. */
export type FactOrigin = 'observed' | 'config' | 'unknown'

export interface RawObservation<T> {
  status: 'known' | 'unknown'
  value?: T
  source: string
  origin?: FactOrigin
  observedAt?: string
  freshUntil?: string
}

export interface ResolvedObservation<T> {
  status: 'known' | 'unknown' | 'stale' | 'expired'
  freshness: 'fresh' | 'unknown' | 'stale' | 'expired'
  origin: FactOrigin
  usable: boolean
  value?: T
  source: string
  observedAt?: string
  freshUntil?: string
}

export function unknownObservation(source: string, observedAt?: string): RawObservation<never> {
  return { status: 'unknown', source, observedAt }
}

export function factOrigin(raw: RawObservation<unknown> | undefined): FactOrigin {
  if (!raw) return 'unknown'
  if (raw.origin === 'observed' || raw.origin === 'config' || raw.origin === 'unknown') return raw.origin
  if (raw.source.startsWith('observed:')) return 'observed'
  if (raw.source.startsWith('config:') || raw.source === 'file-fixture') return 'config'
  return 'unknown'
}

export function resolveObservation<T>(raw: RawObservation<T> | undefined, nowMs: number): ResolvedObservation<T> {
  const origin = factOrigin(raw)
  if (!raw || raw.status === 'unknown' || origin === 'unknown') {
    return {
      status: 'unknown',
      freshness: 'unknown',
      origin: 'unknown',
      usable: false,
      source: raw?.source || 'missing',
      observedAt: raw?.observedAt,
      freshUntil: raw?.freshUntil,
    }
  }
  if (raw.value === undefined || !raw.source || !raw.observedAt) {
    return {
      status: 'unknown',
      freshness: 'unknown',
      origin,
      usable: false,
      source: raw.source || 'missing',
      observedAt: raw.observedAt,
      freshUntil: raw.freshUntil,
    }
  }
  if (!raw.freshUntil) {
    return {
      status: 'stale',
      freshness: 'stale',
      origin,
      usable: false,
      value: raw.value,
      source: raw.source,
      observedAt: raw.observedAt,
    }
  }
  const until = Date.parse(raw.freshUntil)
  if (!Number.isFinite(until) || nowMs > until) {
    return {
      status: 'expired',
      freshness: 'expired',
      origin,
      usable: false,
      value: raw.value,
      source: raw.source,
      observedAt: raw.observedAt,
      freshUntil: raw.freshUntil,
    }
  }
  return {
    status: 'known',
    freshness: 'fresh',
    origin,
    usable: true,
    value: raw.value,
    source: raw.source,
    observedAt: raw.observedAt,
    freshUntil: raw.freshUntil,
  }
}
