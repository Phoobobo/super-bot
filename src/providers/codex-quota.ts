import { spawn } from 'node:child_process'
import type { QuotaValue } from '../core/model.js'
import type { RawObservation } from '../observe.js'

/**
 * Documented Codex app-server method. No params: that avoids the Luna Reserve experiment.
 * https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/account.rs
 * usedPercent is not a remaining balance, and normalModelSlug is not the hc session model.
 */
export const CODEX_RATE_LIMITS_METHOD = 'account/rateLimits/read'

export interface CodexIo {
  send(line: string): void
  next(): Promise<string | undefined>
  close(): void
}

export async function readCodexRateLimits(io: CodexIo, nowIso: string): Promise<RawObservation<QuotaValue>> {
  try {
    io.send(JSON.stringify({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'super-bot', version: '0.1.0' } },
    }))
    const init = await waitForId(io, 1)
    if (!init || init.error) return unavailable(nowIso, 'codex-app-server-initialize')
    io.send(JSON.stringify({ method: 'initialized' }))
    io.send(JSON.stringify({ id: 2, method: CODEX_RATE_LIMITS_METHOD }))
    const reply = await waitForId(io, 2)
    if (!reply) return unavailable(nowIso, 'codex-app-server-silent')
    if (reply.error) return unavailable(nowIso, 'codex-rate-limits-unavailable')
    const primary = reply.result?.rateLimits?.primary
    const used = primary?.usedPercent
    if (typeof used !== 'number' || !Number.isFinite(used)) return unavailable(nowIso, 'codex-rate-limits-unparsed')
    const resets = typeof primary?.resetsAt === 'number' ? new Date(primary.resetsAt * 1000).toISOString() : undefined
    return {
      status: 'known',
      origin: 'observed',
      source: 'observed:codex-app-server',
      observedAt: nowIso,
      freshUntil: resets,
      value: { usedPercent: used, resetsAt: resets },
    }
  } catch {
    return unavailable(nowIso, 'codex-app-server-error')
  } finally {
    io.close()
  }
}

export function spawnCodexAppServer(bin = 'codex'): CodexIo & { done: Promise<void> } {
  const child = spawn(bin, ['app-server'], { shell: false, stdio: ['pipe', 'pipe', 'ignore'] })
  let buffer = ''
  const queue: string[] = []
  let waiter: ((line: string | undefined) => void) | undefined
  const push = (line: string) => {
    if (waiter) {
      const resume = waiter
      waiter = undefined
      resume(line)
    } else queue.push(line)
  }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) if (part.trim()) push(part)
  })
  const done = new Promise<void>((resolve) => {
    child.on('close', () => resolve())
    child.on('error', () => resolve())
  })
  return {
    send(line: string) {
      child.stdin.write(`${line}\n`)
    },
    next() {
      const queued = queue.shift()
      if (queued !== undefined) return Promise.resolve(queued)
      return new Promise((resolve) => {
        waiter = resolve
      })
    },
    close() {
      child.stdin.end()
      child.kill('SIGTERM')
    },
    done,
  }
}

function unavailable(nowIso: string, source: string): RawObservation<QuotaValue> {
  return { status: 'unknown', origin: 'unknown', source, observedAt: nowIso }
}

async function waitForId(io: CodexIo, id: number): Promise<CodexReply | undefined> {
  for (let i = 0; i < 20; i += 1) {
    const line = await io.next()
    if (!line) return undefined
    const parsed = JSON.parse(line) as CodexReply
    if (parsed.id === id) return parsed
  }
  return undefined
}

interface CodexReply {
  id?: number
  error?: { message?: string }
  result?: { rateLimits?: { primary?: { usedPercent?: number; resetsAt?: number } | null } }
}
