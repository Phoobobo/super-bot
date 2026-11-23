import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { RealBac } from '../src/bac/real.js'
import { launchArgs } from '../src/bac/argv.js'
import { BAC_V1 } from '../src/bac/contract.js'
import { startHttp } from '../src/http.js'
import { baseRequest, openRuntime } from './helpers.js'
import type { Runtime } from '../src/runtime.js'
import type { SpawnFn } from '../src/bac/adapter.js'

const opened: Runtime[] = []
afterEach(() => {
  for (const runtime of opened) runtime.close()
  opened.length = 0
})

describe('bac adapter', () => {
  it('dry-run records an argv array and does not spawn', async () => {
    const spawn: SpawnFn = async () => {
      throw new Error('spawned')
    }
    const runtime = openRuntime({ adapter: 'real', mode: 'dry-run', profile: BAC_V1, spawn })
    opened.push(runtime)
    const created = await baseRequest(runtime, 'dry-1', { phases: ['design'] })
    const assignment = runtime.view(created.ticketId ?? '').assignments[0]
    expect(assignment?.status).toBe('planned')
    expect(assignment?.simulated).toBe(false)
    expect(Array.isArray(assignment?.argv)).toBe(true)
    expect(assignment?.argv?.[0]).toBe('launch')
    expect(assignment?.argv?.includes('--kind')).toBe(true)
    expect(runtime.view(created.ticketId ?? '').ticket.phase).toBe('open')
    const launch = runtime.adapter.calls.find((call) => call.op === 'launch')
    expect(launch?.argv.some((arg) => arg.includes('$(echo pwned)'))).toBe(false)
    const prompt = fs.readFileSync(launch?.argv[launch.argv.indexOf('--prompt-file') + 1] ?? '', 'utf8')
    expect(prompt).toContain('$(echo pwned)')
  })

  it('live mode spawns with shell false and refuses pi on the stock profile', async () => {
    const seen: { shell: boolean; bin: string; args: string[] }[] = []
    const spawn: SpawnFn = async (request) => {
      seen.push({ shell: request.shell, bin: request.bin, args: request.args })
      return { code: 0, stdout: '{"ok":true}', timedOut: false }
    }
    const runtime = openRuntime({
      adapter: 'real',
      mode: 'live',
      allowLive: true,
      profile: BAC_V1,
      spawn,
    })
    opened.push(runtime)
    await baseRequest(runtime, 'live-1', { phases: ['design'] })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.shell).toBe(false)
    expect(seen[0]?.bin).toBe('bac')
    expect(Array.isArray(seen[0]?.args)).toBe(true)
    expect(seen[0]?.args.includes('--kind')).toBe(true)

    const blocked = new RealBac({ mode: 'live', allowLive: true, profile: BAC_V1, spawn })
    const result = await blocked.launch(launchArgs({
      repo: '/work/example-repo',
      kind: 'pi',
      taskId: 'sb-example',
      owner: 'grok-bot',
      promptFile: '/tmp/prompt.txt',
    }))
    expect(result.outcome).toBe('blocked')
    if (result.outcome === 'blocked') {
      expect(result.code).toBe('kind_unsupported')
      expect(result.kind).toBe('pi')
      expect(result.kindSupport).toBe('rejected')
      expect(result.argv.includes('codex')).toBe(false)
    }
    expect(seen).toHaveLength(1)
  })

  it('does not call hc or herdr directly', () => {
    const source = fs.readFileSync(new URL('../src/bac/real.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/shell:\s*true/)
    expect(source).not.toMatch(/\bexec\(|execSync/)
    const root = fileURLToPath(new URL('../src', import.meta.url))
    const files = walk(root)
    expect(files.length).toBeGreaterThan(0)
    const joined = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
    expect(joined).not.toMatch(/spawn\(\s*['"]hc['"]/)
    expect(joined).not.toMatch(/spawn\(\s*['"]herdr['"]/)
  })
})

describe('http', () => {
  it('serves health and a dry-run request on localhost', async () => {
    const runtime = openRuntime({ adapter: 'real', mode: 'dry-run', profile: BAC_V1 })
    opened.push(runtime)
    const http = await startHttp(runtime, 0)
    try {
      const health = await fetch(`${http.url}/v1/health`)
      expect(health.status).toBe(200)
      const body = (await health.json()) as { mode: string; simulated: boolean }
      expect(body.mode).toBe('dry-run')
      expect(body.simulated).toBe(false)
      const response = await fetch(`${http.url}/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: 'http-1',
          text: '只读',
          scope: '不改仓库',
          acceptance: ['tests'],
          phases: ['execute'],
        }),
      })
      expect(response.status).toBe(200)
      const payload = (await response.json()) as {
        ticket: { assignments: { block?: { code?: string; kindSupport?: string; requirement?: string } }[] }
      }
      expect(payload.ticket.assignments[0]?.block?.code).toBe('kind_unsupported')
      expect(payload.ticket.assignments[0]?.block?.kindSupport).toBe('rejected')
    } finally {
      await http.close()
    }
  })
})

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const next = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(next) : [next]
  })
}
