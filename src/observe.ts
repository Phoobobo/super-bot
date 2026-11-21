/**
 * A fact we might not have. Usable numbers require status known, a source,
 * an observation time, and a freshUntil that is still ahead. Anything else
 * stays unknown, stale, or expired and must not be treated as a balance or a model id.
 */
export interface RawObservation<T> {
  status: 'known' | 'unknown'
  value?: T
  source: string
  observedAt?: string
  freshUntil?: string
}

export interface ResolvedObservation<T> {
  status: 'known' | 'unknown' | 'stale' | 'expired'
  freshness: 'fresh' | 'unknown' | 'stale' | 'expired'
  usable: boolean
  value?: T
  source: string
  observedAt?: string
  freshUntil?: string
}

export function unknownObservation(source: string, observedAt?: string): RawObservation<never> {
  return { status: 'unknown', source, observedAt }
}

export function resolveObservation<T>(raw: RawObservation<T> | undefined, nowMs: number): ResolvedObservation<T> {
  if (!raw || raw.status === 'unknown') {
    return {
      status: 'unknown',
      freshness: 'unknown',
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
    usable: true,
    value: raw.value,
    source: raw.source,
    observedAt: raw.observedAt,
    freshUntil: raw.freshUntil,
  }
}
