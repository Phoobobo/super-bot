import { spawn } from 'node:child_process'
import type { QuotaValue } from '../core/model.js'
import type { RawObservation } from '../observe.js'

export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
}

/** `grok usage --json` is not a balance API. Exit 1 means unavailable, not zero. */
export function interpretGrokUsage(result: CommandResult, nowIso: string): RawObservation<QuotaValue> {
  if (result.code !== 0) {
    return { status: 'unknown', origin: 'unknown', source: 'grok-usage-unavailable', observedAt: nowIso }
  }
  return { status: 'unknown', origin: 'unknown', source: 'grok-usage-unparsed', observedAt: nowIso }
}

export function runGrokUsage(bin = 'grok'): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['usage', '--json'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ code: null, stdout, stderr })
    }, 5_000)
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr: 'grok-cli-missing' })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

export async function grokQuota(nowIso: string, run: () => Promise<CommandResult> = () => runGrokUsage()): Promise<RawObservation<QuotaValue>> {
  const result = await run()
  if (result.stderr === 'grok-cli-missing') {
    return { status: 'unknown', origin: 'unknown', source: 'grok-cli-missing', observedAt: nowIso }
  }
  return interpretGrokUsage(result, nowIso)
}
