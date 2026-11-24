import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/real-bac-preflight.mjs')

function run(env: NodeJS.ProcessEnv): Promise<{ code: number | null; json: Record<string, unknown> | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.on('close', (code) => {
      let json: Record<string, unknown> | null = null
      try {
        json = JSON.parse(stdout) as Record<string, unknown>
      } catch {
        json = null
      }
      resolve({ code, json, stdout })
    })
  })
}

describe('real bac preflight', () => {
  it('refuses a missing bac binary and does not claim E2E', async () => {
    const result = await run({
      ...process.env,
      PATH: '/usr/bin:/bin',
      SUPERBOT_BAC_BIN: '/tmp/sbot-missing-bac/bac',
      SUPERBOT_BOT_URL: '',
    })
    expect(result.code).toBe(2)
    expect(result.json?.realE2E).toBe(false)
    expect(result.json?.launched).toBe(false)
    expect(result.json?.callbackInjected).toBe(false)
    expect(result.json?.cleaned).toBe(true)
    const gaps = result.json?.gaps
    expect(Array.isArray(gaps) && gaps.length > 0).toBe(true)
  })
})
