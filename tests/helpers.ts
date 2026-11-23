import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BAC_V1, type CapabilityProfile } from '../src/bac/contract.js'
import { Runtime, type Clock } from '../src/runtime.js'
import type { FakeScript } from '../src/bac/fake.js'
import type { QuotaProvider } from '../src/quota.js'
import type { SpawnFn } from '../src/bac/adapter.js'
import type { BotTarget } from '../src/delivery.js'
import type { RawObservation } from '../src/observe.js'

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-'))
}

export function clockAt(iso = '2026-01-01T00:00:00.000Z'): Clock & { advance(ms: number): void } {
  let ms = Date.parse(iso)
  return {
    now: () => new Date(ms),
    ms: () => ms,
    advance(amount: number) {
      ms += amount
    },
  }
}

export function openRuntime(options: {
  profile?: CapabilityProfile
  adapter?: 'fake' | 'real'
  mode?: 'dry-run' | 'live'
  allowLive?: boolean
  script?: FakeScript
  quota?: QuotaProvider
  clock?: Clock
  autoDrain?: boolean
  stuckAfterMs?: number
  dir?: string
  spawn?: SpawnFn
  bot?: BotTarget
  fetchImpl?: typeof fetch
  model?: RawObservation<string>
} = {}): Runtime {
  return new Runtime({
    dir: options.dir ?? tempDir(),
    profile: options.profile ?? BAC_V1,
    adapter: options.adapter ?? 'fake',
    mode: options.mode,
    allowLive: options.allowLive,
    fakeScript: options.script,
    quota: options.quota,
    clock: options.clock,
    autoDrain: options.autoDrain,
    stuckAfterMs: options.stuckAfterMs,
    spawn: options.spawn,
    bot: options.bot,
    fetchImpl: options.fetchImpl,
    model: options.model,
  })
}

export const stock = BAC_V1
export const simulated = BAC_V1

export async function baseRequest(runtime: Runtime, requestId = 'req-1', extra: Partial<Parameters<Runtime['request']>[0]> = {}) {
  return runtime.request({
    actor: 'grok-bot',
    text: '补健康检查',
    scope: '只改示例仓库。$(echo pwned)',
    acceptance: ['tests'],
    acceptancePath: 'bot 提交 harness 证据',
    phases: ['design', 'execute', 'verify'],
    requestId,
    channel: 'grok-bot',
    repo: '/work/example-repo',
    ...extra,
  })
}
