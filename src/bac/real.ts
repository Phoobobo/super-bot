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
 * This process does not install bac. A launch waits for bac to print its one JSON document.
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

/**
 * Short commands stay on the old bound. `bac launch` does not.
 *
 * 10e1d2b `commands.json` says launch prints one JSON document and then exits.
 * Exit 0 covers both a submitted prompt and `startup_blocked`. The consumer cannot
 * tell those apart until the process exits, so it must not kill the process first.
 *
 * A successful herdr launch in `bin/bac` `cmd_launch` may still be inside:
 * the initial 1s pause, three `herdr agent start --timeout 60000` tries with two 3s gaps,
 * `startup_settle_sec` default 4, `startup_ready_timeout_sec` default 90,
 * one `herdr agent prompt --timeout 30000`, and `verify_submitted`'s 10 one-second checks.
 * The hc path is shorter: settle 4, ready 90, then three send attempts.
 * Those defaults live in `config.example.toml`. This process does not read the operator's file.
 * Fifteen extra seconds cover `hc run` and the JSON write. Prompt retries after a dropped
 * first prompt are outside this bound.
 */
const HERDR_LAUNCH_SUCCESS_MS = 1_000 + 3 * 60_000 + 2 * 3_000 + 4_000 + 90_000 + 30_000 + 10_000
const LAUNCH_START_MARGIN_MS = 15_000
export const BAC_LAUNCH_WAIT_MS = HERDR_LAUNCH_SUCCESS_MS + LAUNCH_START_MARGIN_MS
export const BAC_SHORT_WAIT_MS = 5_000

export function bacWaitMs(args: readonly string[]): number {
  return args[0] === 'launch' ? BAC_LAUNCH_WAIT_MS : BAC_SHORT_WAIT_MS
}

function defaultSpawn(request: SpawnRequest): Promise<{ code: number | null; stdout: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(request.bin, request.args, { shell: request.shell, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let settled = false
    const finish = (result: { code: number | null; stdout: string; timedOut: boolean }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish({ code: null, stdout, timedOut: true })
    }, bacWaitMs(request.args))
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.on('data', () => {})
    child.on('error', () => finish({ code: null, stdout, timedOut: true }))
    child.on('close', (code) => finish({ code, stdout, timedOut: false }))
  })
}
