import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Runtime } from './runtime.js'
import { UserError } from './core/errors.js'
import type { PreferencePatch, Role } from './core/model.js'
import { parseSnapshot } from './takeover/snapshot.js'

export async function startHttp(runtime: Runtime, port: number): Promise<{ port: number; url: string; close: () => Promise<void> }> {
  const token = process.env.SUPERBOT_TOKEN
  const server = createServer(async (req, res) => {
    try {
      if (token && req.headers.authorization !== `Bearer ${token}`) {
        send(res, 401, { error: { code: 'unauthorized', message: '需要 Bearer 令牌' } })
        return
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const body = await readBody(req)
      const actor = actorFrom(req)
      if (typeof body.actor === 'string' && body.actor !== actor) {
        throw new UserError('actor-mismatch', '请求体里的 actor 和调用身份不一致')
      }
      const result = await route(runtime, req.method ?? 'GET', url.pathname, body, actor)
      send(res, result.status, result.body)
    } catch (error) {
      if (error instanceof UserError) send(res, 400, { error: { code: error.code, message: error.message } })
      else send(res, 500, { error: { code: 'internal', message: error instanceof Error ? error.message : 'error' } })
    }
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()))
  const address = server.address()
  const actual = typeof address === 'object' && address ? address.port : port
  return {
    port: actual,
    url: `http://127.0.0.1:${actual}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

async function route(
  runtime: Runtime,
  method: string,
  pathname: string,
  body: Record<string, unknown>,
  actor: string,
): Promise<{ status: number; body: unknown }> {
  if (method === 'GET' && pathname === '/v1/health') {
    return { status: 200, body: { ok: true, profile: runtime.profile.id, simulated: runtime.profile.simulated, mode: runtime.adapter.mode } }
  }
  if (method === 'GET' && pathname === '/v1/capabilities') return { status: 200, body: runtime.profile }
  if (method === 'GET' && pathname === '/v1/preferences') {
    const preference = runtime.currentPreference()
    return { status: 200, body: { preference, ledger: runtime.store.ledger(), paused: runtime.store.paused() } }
  }
  if (method === 'GET' && pathname === '/v1/inbox') return { status: 200, body: { messages: runtime.inbox() } }
  if (method === 'POST' && pathname === '/v1/requests') {
    const result = await runtime.request({
      actor,
      text: String(body.text ?? ''),
      scope: String(body.scope ?? ''),
      acceptance: stringList(body.acceptance),
      acceptancePath: String(body.acceptancePath ?? '由 bot 提交 harness 证据'),
      phases: phasesOf(body.phases),
      requestId: String(body.requestId ?? ''),
      channel: String(body.channel ?? 'grok-bot'),
      repo: String(body.repo ?? '/work/example-repo'),
    })
    return { status: 200, body: result.ticketId ? { ...result, ticket: runtime.view(result.ticketId) } : result }
  }
  if (method === 'POST' && pathname === '/v1/callbacks/gbb') {
    return { status: 200, body: await runtime.callback(body as unknown as Parameters<Runtime['callback']>[0]) }
  }
  if (method === 'POST' && pathname === '/v1/takeover') {
    const result = await runtime.takeover(parseSnapshot(body))
    return { status: 200, body: { ...result, ticket: runtime.view(result.ticketId) } }
  }
  if (method === 'POST' && pathname === '/v1/evidence') {
    const evidence = await runtime.evidence(
      String(body.assignmentId),
      body.producer === 'agent' ? 'agent' : 'harness',
      (body.checks as { id: string; ok: boolean }[]) ?? [],
      actor,
    )
    return { status: 200, body: evidence }
  }
  if (method === 'POST' && pathname === '/v1/preferences/propose') {
    return { status: 200, body: runtime.propose((body.patch as PreferencePatch) ?? {}) }
  }
  if (method === 'POST' && pathname === '/v1/preferences/confirm') {
    return { status: 200, body: runtime.confirm(String(body.proposalId), String(body.option ?? 'apply')) }
  }
  if (method === 'POST' && pathname === '/v1/preferences/revert') {
    return { status: 200, body: runtime.revert(Number(body.version)) }
  }
  if (method === 'POST' && pathname === '/v1/pause') {
    runtime.pause()
    return { status: 200, body: { paused: true } }
  }
  if (method === 'POST' && pathname === '/v1/resume') return { status: 200, body: { opened: await runtime.resume() } }
  const ticket = pathname.match(/^\/v1\/tickets\/([^/]+)$/)
  if (ticket && method === 'GET') return { status: 200, body: runtime.view(decodeURIComponent(ticket[1] ?? '')) }
  const cancel = pathname.match(/^\/v1\/tickets\/([^/]+)\/cancel$/)
  if (cancel && method === 'POST') {
    return { status: 200, body: await runtime.cancel(decodeURIComponent(cancel[1] ?? ''), String(body.reason ?? 'cancelled')) }
  }
  const ack = pathname.match(/^\/v1\/inbox\/([^/]+)\/ack$/)
  if (ack && method === 'POST') return { status: 200, body: runtime.ack(decodeURIComponent(ack[1] ?? '')) }
  return { status: 404, body: { error: { code: 'not-found', message: pathname } } }
}

function actorFrom(req: IncomingMessage): string {
  const header = req.headers['x-superbot-actor']
  return typeof header === 'string' && header ? header : 'grok-bot'
}

function phasesOf(value: unknown): Role[] {
  if (!Array.isArray(value) || value.length === 0) return ['design', 'execute', 'verify']
  return value.map(String) as Role[]
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean)
  return []
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(json) })
  res.end(json)
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 1_000_000) throw new UserError('body-too-large', '请求体超过 1MB')
    chunks.push(buffer)
  }
  if (!chunks.length) return {}
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (!parsed || typeof parsed !== 'object') throw new UserError('bad-json', '请求体要是 JSON 对象')
  return parsed as Record<string, unknown>
}
