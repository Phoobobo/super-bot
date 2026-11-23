import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { launchArgs } from '../src/gbb/argv.js'
import { RealGbb } from '../src/gbb/real.js'
import { GBB_033 } from '../src/gbb/contract.js'
import { resolveObservation } from '../src/observe.js'
import { configQuota } from '../src/quota.js'
import { fixedQuota } from '../src/quota.js'
import { exampleSnapshot } from '../src/demo.js'
import { startHttp } from '../src/http.js'
import { baseRequest, openRuntime, stock } from './helpers.js'
import type { Runtime } from '../src/runtime.js'
import type { SpawnFn } from '../src/gbb/adapter.js'

const opened: Runtime[] = []
afterEach(() => {
  for (const runtime of opened) runtime.close()
  opened.length = 0
})

function use(runtime: Runtime): Runtime {
  opened.push(runtime)
  return runtime
}

function listen(failUntil = 0): Promise<{
  url: string
  posts: { id?: string; purpose?: string }[]
  close(): Promise<void>
}> {
  const posts: { id?: string; purpose?: string }[] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id?: string; purpose?: string }
      posts.push(body)
      const status = posts.length <= failUntil ? 503 : 204
      res.writeHead(status)
      res.end()
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}/bot`,
        posts,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

describe('bot loop', () => {
  it('posts the result to the original bot and does not post it twice', async () => {
    const bot = await listen()
    const runtime = use(openRuntime({ bot: { url: bot.url } }))
    const httpServer = await startHttp(runtime, 0)
    try {
      const response = await fetch(`${httpServer.url}/v1/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestId: 'loop-1',
          text: '补健康检查',
          scope: '只改示例仓库',
          acceptance: ['tests'],
          phases: ['design'],
        }),
      })
      const created = (await response.json()) as { ticketId: string }
      const assignment = runtime.view(created.ticketId).assignments[0]
      await runtime.callback({
        event: 'agent_status',
        event_id: 'loop-done',
        task_id: assignment?.gbbTaskId,
        status: 'done',
        ts: '2026-01-01T00:00:00.000Z',
        owner: 'grok-bot',
      })
      await runtime.evidence(assignment?.id ?? '', 'harness', [
        { id: 'role:design', ok: true },
        { id: 'tests', ok: true },
      ])
      const purposes = bot.posts.map((item) => item.purpose)
      expect(purposes).toContain('summary')
      const delivered = bot.posts.filter((item) => item.purpose === 'summary')
      expect(delivered).toHaveLength(1)
      expect(runtime.inbox()).toHaveLength(0)
      const summary = runtime.view(created.ticketId).messages.find((item) => item.purpose === 'summary')
      expect(summary?.status).toBe('delivered')
      const before = bot.posts.length
      await runtime.drain()
      expect(bot.posts).toHaveLength(before)
    } finally {
      await httpServer.close()
      await bot.close()
    }
  })

  it('retries a failed delivery, then records failure without a second message', async () => {
    const bot = await listen(99)
    const runtime = use(openRuntime({ bot: { url: bot.url }, autoDrain: false }))
    const created = await baseRequest(runtime, 'fail-1', { phases: ['design'] })
    await runtime.drain()
    expect(bot.posts.length).toBeGreaterThanOrEqual(3)
    const messages = runtime.view(created.ticketId ?? '').messages
    expect(messages.every((item) => item.status === 'failed')).toBe(true)
    expect(new Set(bot.posts.map((item) => item.id)).size).toBe(messages.length)
    await runtime.drain()
    expect(bot.posts.length).toBeGreaterThanOrEqual(3)
    const after = bot.posts.length
    await runtime.drain()
    expect(bot.posts).toHaveLength(after)
    await bot.close()
  })

  it('redelivers the same id after a restart and ignores another owner', async () => {
    const bot = await listen()
    const first = use(openRuntime({ bot: { url: bot.url }, autoDrain: false }))
    const created = await baseRequest(first, 'restart-bot', { phases: ['design'] })
    const reply = first.store.effects().find((effect) => effect.kind === 'reply')
    if (!reply) throw new Error('missing reply')
    reply.status = 'running'
    first.store.atomic(() => first.store.writeEffect(reply))
    const dir = first.store.dir
    first.close()
    opened.pop()
    const second = use(openRuntime({ dir, bot: { url: bot.url }, autoDrain: false }))
    await second.drain()
    expect(bot.posts.length).toBeGreaterThan(0)
    const ids = bot.posts.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    const before = bot.posts.length
    const assignment = second.view(created.ticketId ?? '').assignments[0]
    const rejected = await second.callback({
      event: 'agent_status',
      task_id: assignment?.gbbTaskId,
      status: 'done',
      ts: '2026-01-01T00:00:00.000Z',
      owner: 'other-bot',
    })
    expect(rejected.rejected).toBe('owner-mismatch')
    expect(second.view(created.ticketId ?? '').assignments[0]?.status).not.toBe('claimed')
    expect(bot.posts).toHaveLength(before)
    await bot.close()
  })

  it('keeps takeover authorization and does not execute unknown work', async () => {
    const runtime = use(openRuntime({ profile: stock }))
    const created = await runtime.takeover(exampleSnapshot())
    const view = runtime.view(created.ticketId)
    expect(view.mandate.actor).toBe('grok-bot')
    expect(view.mandate.scope).toBe(exampleSnapshot().authorization.scope)
    expect(view.mandate.acceptance).toEqual(['tests'])
    expect(view.ticket.unknownItems).toHaveLength(1)
    expect(view.assignments.find((item) => item.itemKey === 'done-1')?.status).toBe('skipped')
    expect(view.ticket.observedContext?.source).toBe('gbb-read')
    expect(runtime.adapter.calls.some((call) => call.op === 'launch')).toBe(false)
    expect(view.ticket.phase).toBe('open')
  })
})

describe('facts and live guard', () => {
  it('labels config numbers as config and refuses to treat an unlabeled number as observed', () => {
    const now = '2026-01-01T00:00:00.000Z'
    const configured = resolveObservation(
      configQuota('{"remaining":4,"origin":"observed","freshUntil":"2026-02-01T00:00:00.000Z"}', now),
      Date.parse(now),
    )
    expect(configured.origin).toBe('config')
    expect(configured.usable).toBe(true)
    const unlabeled = resolveObservation(
      { status: 'known', value: { remaining: 9 }, source: 'vendor-api', observedAt: now, freshUntil: '2026-02-01T00:00:00.000Z' },
      Date.parse(now),
    )
    expect(unlabeled.origin).toBe('unknown')
    expect(unlabeled.usable).toBe(false)
    const runtime = use(openRuntime({ quota: fixedQuota(configQuota('{"remaining":4,"freshUntil":"2026-02-01T00:00:00.000Z"}', now)) }))
    expect(runtime.facts().realE2E).toBe(false)
    expect(runtime.facts().quota.origin).toBe('config')
    expect(runtime.facts().model.origin).toBe('unknown')
    expect(runtime.facts().model.source).toBe('hc-get-has-no-model-field')
  })

  it('does not spawn on dry-run and does not launch pi on gbb 0.3.3', async () => {
    const spawn: SpawnFn = () => Promise.resolve({ code: 0, stdout: '{}', timedOut: false })
    const dry = new RealGbb({ mode: 'dry-run', profile: GBB_033, spawn })
    const blocked = await dry.launch(launchArgs({ repo: '/work/example-repo', kind: 'pi', taskId: 't1', owner: 'grok-bot', promptFile: '/tmp/prompt.txt' }))
    expect(blocked.outcome).toBe('blocked')
    expect(dry.calls[0]?.argv.includes('pi')).toBe(true)
    const refused = new RealGbb({ mode: 'live', profile: GBB_033, allowLive: false, spawn })
    await expect(
      refused.launch(launchArgs({ repo: '/work/example-repo', kind: 'codex', taskId: 't2', owner: 'grok-bot', promptFile: '/tmp/prompt.txt' })),
    ).rejects.toThrow(/allowLive/)
    let shell: boolean | undefined
    const watched: SpawnFn = (request) => {
      shell = request.shell
      return Promise.resolve({ code: 0, stdout: '{}', timedOut: false })
    }
    const live = new RealGbb({ mode: 'live', profile: GBB_033, allowLive: true, spawn: watched })
    const started = await live.launch(launchArgs({ repo: '/work/example-repo', kind: 'codex', taskId: 't3', owner: 'grok-bot', promptFile: '/tmp/prompt.txt' }))
    expect(started.outcome).toBe('ok')
    expect(shell).toBe(false)
    expect(live.calls[0]?.argv.includes('-m')).toBe(false)
  })

  it('recommends role options and does not change them until confirm', async () => {
    const runtime = use(openRuntime({ profile: stock }))
    const proposal = runtime.recommend()
    expect(proposal.options.map((option) => option.id)).toEqual(['keep', 'more-grok', 'substitutes-only'])
    expect(proposal.recommendation).toContain('不会悄悄换成 codex')
    const kept = runtime.confirm(proposal.id, 'keep')
    expect(kept.version).toBe(1)
    expect(kept.executeSubstitutes).toEqual([])
    const next = runtime.recommend()
    const saved = runtime.confirm(next.id, 'substitutes-only')
    expect(saved.executeSubstitutes).toEqual(['codex'])
    const created = await baseRequest(runtime, 'sub-1', { phases: ['execute'] })
    const assignment = runtime.view(created.ticketId ?? '').assignments[0]
    expect(assignment?.plan?.sample.selection).toBe('user-approved-substitute')
    expect(assignment?.plan?.kind).toBe('codex')
  })
})
