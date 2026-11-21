import { createHash } from 'node:crypto'

/** Ids derived from their inputs, equal for equal inputs. */
export function stableId(prefix: string, parts: readonly string[]): string {
  const hex = createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 16)
  return `${prefix}_${hex}`
}

/** gbb task ids are sanitized to `[a-z0-9_-]` and cut at 40 characters (`bin/gbb` sanitize_id). */
export function gbbTaskId(assignmentId: string): string {
  const hex = createHash('sha256').update(assignmentId).digest('hex').slice(0, 20)
  return `sb-${hex}`
}

export function seedUint(parts: readonly string[]): number {
  return createHash('sha256').update(parts.join('\0')).digest().readUInt32BE(0)
}

/** Mulberry32. One draw in `[0, 1)`. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
