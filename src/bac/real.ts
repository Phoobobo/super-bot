import { spawn } from 'node:child_process'
import type { CapabilityProfile } from './contract.js'
import { classifyLaunchKind } from './contract.js'
import type { AdapterCall, AdapterResult, BacAdapter, SpawnFn, SpawnRequest } from './adapter.js'
import { assertBacBin, kindOf } from './argv.js'
import { UserError } from '../core/errors.js'

export interface RealOptions {
  bin?: string
  mode: 'dry-run' | 'live'
  profile: CapabilityProfile
  allowLive?: boolean
  spawn?: SpawnFn
}

/**
 * Real bac transport. Default is dry-run: the argv is recorded and nothing is spawned.
 * Live mode still refuses unless `allowLive` is set, and it never uses a shell.
 * The bac binary is not implemented in this repository, so this process does not install or switch it.
 */
export class RealBac implements BacAdapter {
  readonly calls: AdapterCall[] = []
  readonly mode: 'dry-run' | 'live'
  readonly profile: CapabilityProfile
  private readonly bin: string
  private readonly allowLive: boolean
  private readonly spawnImpl: SpawnFn
  constructor(options: RealOptions) {
    this.mode = options.mode
    this.profile = options.profile
    this.bin = options.bin ?? 'bac'
    this.allowLive = options.allowLive === true
    this.spawnImpl = options.spawn ?? defaultSpawn
    assertBacBin(this.bin)
  }

  launch(args: string[]): Promise<AdapterResult> {
    const refused = refuseKind(args)
    if (refused) {
      this.calls.push({ op: 'launch', argv: [...args] })
      return Promise.resolve(refused)
    }
    return this.run('launch', args)
  }

  send(args: string[]): Promise<AdapterResult> {
    return this.run('send', args)
  }

  handover(args: string[]): Promise<AdapterResult> {
    return this.run('handover', args)
  }

  read(args: string[]): Promise<AdapterResult> {
    return this.run('read', args)
  }

  status(args: string[]): Promise<AdapterResult> {
    return this.run('status', args)
  }

  stop(args: string[]): Promise<AdapterResult> {
    return this.run('stop', args)
  }

  private async run(op: AdapterCall['op'], args: string[]): Promise<AdapterResult> {
    this.calls.push({ op, argv: [...args] })
    if (this.mode === 'dry-run') return { outcome: 'planned', argv: args, dryRun: true }
    if (!this.allowLive) throw new UserError('live-refused', 'live bac is off unless allowLive is set')
    const result = await this.spawnImpl({ bin: this.bin, args, shell: false })
    if (result.timedOut || result.code === null) return { outcome: 'unknown-timeout', argv: args }
    if (result.code !== 0) return { outcome: 'error', code: 'bac-exit', message: `bac exited ${result.code}`, argv: args }
    return { outcome: 'ok', argv: args, simulated: false, body: parseJson(result.stdout) }
  }
}

export function refuseKind(args: string[]): Extract<AdapterResult, { outcome: 'blocked' }> | undefined {
  const kind = kindOf(args)
  const classified = classifyLaunchKind(kind)
  if (classified.ok) return undefined
  if (classified.code === 'kind_required') {
    return {
      outcome: 'blocked',
      code: 'kind_required',
      message: '--kind is required (codex or grok)',
      argv: [...args],
    }
  }
  return {
    outcome: 'blocked',
    code: 'kind_unsupported',
    kind: classified.kind,
    kindSupport: classified.kindSupport,
    message: `kind ${classified.kind} is not implemented`,
    argv: [...args],
  }
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(text) as unknown
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function defaultSpawn(request: SpawnRequest): Promise<{ code: number | null; stdout: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(request.bin, request.args, { shell: request.shell, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ code: null, stdout, timedOut: true })
    }, 5_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: null, stdout, timedOut: true })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, timedOut: false })
    })
  })
}
