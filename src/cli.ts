#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { runDemos } from './demo.js'
import { startHttp } from './http.js'
import { GBB_033, GBB_LAUNCH_KIND_V1_SIMULATED } from './gbb/contract.js'
import type { AgentKind, Intensity, PreferencePatch, Role, WorkflowKind } from './core/model.js'
import { isWorkflowKind } from './workflow/protocol.js'
import { botTargetFromEnv } from './delivery.js'
import { configQuota, fixedQuota } from './quota.js'
import { Runtime } from './runtime.js'
import { parseSnapshot } from './takeover/snapshot.js'
import type { GbbEvent } from './core/model.js'

const HELP = `sbot — super-bot 草稿。Grok Bot 是唯一用户入口，这里只提供 CLI 和本机 API。

  sbot demo                         跑四条模拟场景（fake adapter，不是真实 gbb）
  sbot capabilities                 打印当前采用的 gbb 能力资料
  sbot request --request-id ID --text TEXT --scope SCOPE --acceptance tests
                                    [--workflow feature|bugfix|verify] [--head SHA]
                                    默认 real dry-run，不会启动代理。不写 --workflow 时沿用偏好，默认 off
  sbot request ... --simulate       用模拟的 launch-kind 契约和 fake adapter
  sbot takeover --snapshot FILE     导入接管快照。只有 pane id 会被拒绝
  sbot callback --json FILE         写入一条 gbb 回调
  sbot evidence --assignment ID --check role:execute=ok --producer harness
  sbot preference recommend           给出角色选项。确认前不改偏好
  sbot facts                          打印模型/额度的 observed、config 或 unknown
  sbot preference show
  sbot preference propose [--intensity low|normal|high] [--budget N] [--allow-substitute codex]
                                    [--workflow off|feature|bugfix|verify] [--max-rework N]
  sbot preference confirm --proposal ID --option apply|safer|substitutes-only|keep
  sbot preference revert --version N
  sbot pause | sbot resume
  sbot cancel --ticket ID [--reason TEXT]
  sbot show --ticket ID
  sbot inbox
  sbot inbox ack --id ID
  sbot serve --port 47231 [--live]   默认 dry-run。--live 才会 spawn gbb，且仍不绕过 gbb
  sbot smoke                        打印本机以后的验收步骤，并只做本地 dry-run

状态目录：SUPERBOT_STATE，默认 ./data/superbot
`

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(HELP)
    return 0
  }
  if (command === 'demo') {
    const report = await runDemos()
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return report.scenarios.every((item) => item.ok) ? 0 : 1
  }
  if (command === 'smoke') return smoke()
  if (command === 'capabilities') {
    const profile = flag(rest, '--simulate') ? GBB_LAUNCH_KIND_V1_SIMULATED : GBB_033
    process.stdout.write(`${JSON.stringify({ profile, note: profile.simulated ? '模拟契约，不是已安装的 gbb' : '按 gbb 0.3.3 源码归纳，不是对本机的探测' }, null, 2)}\n`)
    return 0
  }
  const runtime = open(rest)
  try {
    if (command === 'serve') {
      const port = Number(flagValue(rest, '--port') ?? 47231)
      const http = await startHttp(runtime, port)
      process.stdout.write(`${JSON.stringify({ url: http.url, health: `${http.url}/v1/health` })}\n`)
      await new Promise(() => {})
    }
    const body = await dispatch(runtime, command, rest)
    process.stdout.write(`${JSON.stringify(body, null, 2)}\n`)
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'error'
    process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`)
    return 1
  } finally {
    if (command !== 'serve') runtime.close()
  }
}

function open(rest: string[]): Runtime {
  const simulate = flag(rest, '--simulate')
  const live = flag(rest, '--live')
  if (simulate && live) throw new Error('simulate 和 live 不能一起开')
  return new Runtime({
    dir: process.env.SUPERBOT_STATE || path.join(process.cwd(), 'data', 'superbot'),
    adapter: simulate ? 'fake' : 'real',
    profile: simulate ? GBB_LAUNCH_KIND_V1_SIMULATED : GBB_033,
    mode: live ? 'live' : 'dry-run',
    allowLive: live,
    bot: botTargetFromEnv(),
    quota: quotaFromEnv(),
    model: modelFromEnv(),
  })
}

async function dispatch(runtime: Runtime, command: string, rest: string[]): Promise<unknown> {
  switch (command) {
    case 'request':
      return runtime.request({
        actor: 'grok-bot',
        requestId: required(rest, '--request-id'),
        text: required(rest, '--text'),
        scope: required(rest, '--scope'),
        acceptance: required(rest, '--acceptance').split(','),
        acceptancePath: flagValue(rest, '--acceptance-path') ?? '由 Grok Bot 提交 harness 证据',
        phases: (flagValue(rest, '--phases') ?? 'design,execute,verify').split(',') as Role[],
        channel: 'grok-bot',
        repo: flagValue(rest, '--repo') ?? '/work/example-repo',
        workflow: workflowFlag(flagValue(rest, '--workflow')),
        head: flagValue(rest, '--head'),
      }).then((result) => (result.ticketId ? { ...result, ticket: runtime.view(result.ticketId) } : result))
    case 'takeover':
      return runtime.takeover(parseSnapshot(JSON.parse(fs.readFileSync(required(rest, '--snapshot'), 'utf8')))).then((result) => ({
        ...result,
        ticket: runtime.view(result.ticketId),
      }))
    case 'callback':
      return runtime.callback(JSON.parse(fs.readFileSync(required(rest, '--json'), 'utf8')) as GbbEvent)
    case 'evidence': {
      const checks = rest.flatMap((arg, index) => (arg === '--check' ? [rest[index + 1] ?? ''] : []))
      return runtime.evidence(
        required(rest, '--assignment'),
        flagValue(rest, '--producer') === 'agent' ? 'agent' : 'harness',
        checks.filter(Boolean).map((item) => {
          const [id, mark] = item.split('=')
          return { id: id ?? item, ok: mark !== 'fail' }
        }),
        'grok-bot',
        {
          head: flagValue(rest, '--head'),
          command: flagValue(rest, '--command'),
          output: flagValue(rest, '--output'),
          verifier: flagValue(rest, '--verifier'),
        },
      )
    }
    case 'preference':
      return preference(runtime, rest)
    case 'facts':
      return runtime.facts()
    case 'pause':
      runtime.pause()
      return { paused: true }
    case 'resume':
      return { opened: await runtime.resume() }
    case 'cancel':
      return runtime.cancel(required(rest, '--ticket'), flagValue(rest, '--reason') ?? 'cancelled')
    case 'show':
      return runtime.view(required(rest, '--ticket'))
    case 'inbox':
      if (rest[0] === 'ack') return runtime.ack(required(rest, '--id'))
      return { messages: runtime.inbox() }
    default:
      throw new Error(`未知命令 ${command}`)
  }
}

function preference(runtime: Runtime, rest: string[]): unknown {
  const sub = rest[0]
  if (sub === 'show') return { preference: runtime.currentPreference(), ledger: runtime.store.ledger() }
  if (sub === 'recommend') return runtime.recommend()
  if (sub === 'propose') {
    const patch: PreferencePatch = {}
    const intensity = flagValue(rest, '--intensity')
    if (intensity) patch.intensity = intensity as Intensity
    const budget = flagValue(rest, '--budget')
    if (budget) patch.budget = Number(budget)
    const substitute = flagValue(rest, '--allow-substitute')
    if (substitute) patch.executeSubstitutes = [substitute as AgentKind]
    const quota = flagValue(rest, '--unknown-quota')
    if (quota === 'block' || quota === 'mark-and-proceed') patch.unknownQuota = quota
    const workflow = flagValue(rest, '--workflow')
    const rounds = flagValue(rest, '--max-rework')
    if (workflow || rounds) {
      patch.workflow = {}
      if (workflow === 'off' || isWorkflowKind(workflow)) patch.workflow.defaultKind = workflow
      if (rounds) patch.workflow.maxReworkRounds = Number(rounds)
    }
    return runtime.propose(patch)
  }
  if (sub === 'confirm') return runtime.confirm(required(rest, '--proposal'), required(rest, '--option'))
  if (sub === 'revert') return runtime.revert(Number(required(rest, '--version')))
  throw new Error('preference show|propose|confirm|revert')
}

function smoke(): number {
  const lines = [
    'super-bot 本机 smoke（此脚本不会连接用户的机器，也不会调用 gbb）',
    '',
    '稍后在操作者自己的机器上：',
    '1. 确认 gbb 版本是 0.3.3，revision bbdfc4bbaece3ddafa3a9363b1d0f43b230aa5a6。',
    '2. SUPERBOT_STATE 指向一个新目录，运行 sbot capabilities。launchKinds 应只有 grok 和 codex。',
    '3. sbot request --request-id smoke-1 --text "只读检查" --scope "不改仓库" --acceptance tests',
    '   这是 dry-run。执行阶段应停在 capability，requirement 是 gbb.launch.kind=pi，参数里没有 codex 顶上。',
    '4. 不要把 hc ls 的输出当成当前模型。模型字段应保持 unknown，source 含 hc-get-has-no-model-field。',
    '5. 接管必须带完整快照。sbot takeover --snapshot examples/takeover.json。只给 pane id 会失败。',
    '6. 把 gbb 里 owner grok-bot 的 webhook 指到 sbot serve 的 /v1/callbacks/gbb。',
    '   回调没有终端输出，也没有持久重试。重复投递应被去重。',
    '7. 代理自报 done 之后，工单仍是 claimed。由 bot 提交 harness 证据后才验收。',
    '8. 若要真的 spawn gbb，需要另一次明确打开 live，并且这不是本草稿的默认。',
    '',
    '本次只确认：默认资料是 gbb 0.3.3，pi 不在 launchKinds 里。',
    JSON.stringify({ profile: GBB_033.id, launchKinds: GBB_033.launchKinds, realE2E: false }),
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
  return 0
}

function quotaFromEnv() {
  const file = process.env.SUPERBOT_QUOTA_FILE
  if (!file) return undefined
  return fixedQuota(configQuota(fs.readFileSync(file, 'utf8'), new Date().toISOString()))
}

function modelFromEnv() {
  const file = process.env.SUPERBOT_MODEL_FILE
  if (!file) return undefined
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { model?: unknown; observedAt?: unknown; freshUntil?: unknown }
  if (typeof parsed.model !== 'string' || !parsed.model) throw new Error('config model needs a model string')
  return {
    status: 'known' as const,
    origin: 'config' as const,
    value: parsed.model,
    source: 'config:operator',
    observedAt: typeof parsed.observedAt === 'string' ? parsed.observedAt : new Date().toISOString(),
    freshUntil: typeof parsed.freshUntil === 'string' ? parsed.freshUntil : undefined,
  }
}

function workflowFlag(value: string | undefined): WorkflowKind | undefined {
  if (!value) return undefined
  if (!isWorkflowKind(value)) throw new Error('workflow 只能是 feature、bugfix、verify')
  return value
}

function flag(argv: string[], name: string): boolean {
  return argv.includes(name)
}

function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

function required(argv: string[], name: string): string {
  const value = flagValue(argv, name)
  if (!value) throw new Error(`缺少 ${name}`)
  return value
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (entry.endsWith(`${path.sep}cli.js`) || entry.endsWith(`${path.sep}cli.ts`)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exit(1)
    },
  )
}
