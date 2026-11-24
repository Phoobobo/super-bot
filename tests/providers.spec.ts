import { describe, expect, it } from 'vitest'
import { CODEX_RATE_LIMITS_METHOD, readCodexRateLimits, type CodexIo } from '../src/providers/codex-quota.js'
import { interpretGrokUsage } from '../src/providers/grok-quota.js'
import { resolveObservation } from '../src/observe.js'

class ScriptedCodex implements CodexIo {
  readonly sent: string[] = []
  private readonly lines: string[]
  constructor(lines: string[]) {
    this.lines = [...lines]
  }
  send(line: string): void {
    this.sent.push(line)
  }
  next(): Promise<string | undefined> {
    return Promise.resolve(this.lines.shift())
  }
  close(): void {}
}

describe('official quota probes', () => {
  it('reads Codex usedPercent from the documented RPC and does not invent a balance or a session model', async () => {
    const io = new ScriptedCodex([
      JSON.stringify({ id: 1, result: { userAgent: 'fixture' } }),
      JSON.stringify({
        id: 2,
        result: { rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1_730_947_200 } } },
      }),
    ])
    const raw = await readCodexRateLimits(io, '2026-01-01T00:00:00.000Z')
    const resolved = resolveObservation(raw, Date.parse('2026-01-01T00:00:00.000Z'))
    expect(raw.origin).toBe('observed')
    expect(raw.source).toBe('observed:codex-app-server')
    expect(raw.value?.usedPercent).toBe(25)
    expect(raw.value?.remaining).toBeUndefined()
    expect(resolved.usable).toBe(false)
    expect(io.sent.some((line) => line.includes(CODEX_RATE_LIMITS_METHOD))).toBe(true)
    expect(io.sent.some((line) => line.includes('supportsLunaReserve'))).toBe(false)
    expect(JSON.stringify(raw)).not.toContain('gpt')
  })

  it('keeps an auth failure and a grok usage exit as unknown', async () => {
    const denied = new ScriptedCodex([
      JSON.stringify({ id: 1, result: {} }),
      JSON.stringify({ id: 2, error: { message: 'codex account authentication required to read rate limits' } }),
    ])
    const auth = await readCodexRateLimits(denied, '2026-01-01T00:00:00.000Z')
    expect(auth.status).toBe('unknown')
    expect(auth.value).toBeUndefined()
    const grok = interpretGrokUsage({ code: 1, stdout: '', stderr: 'try: grok usage' }, '2026-01-01T00:00:00.000Z')
    expect(grok.status).toBe('unknown')
    expect(grok.origin).toBe('unknown')
    expect(grok.source).toBe('grok-usage-unavailable')
    expect(grok.value).toBeUndefined()
  })
})
