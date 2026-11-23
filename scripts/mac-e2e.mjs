#!/usr/bin/env node
/**
 * Mac acceptance helper. Default is dry-run and talks only to a temporary super-bot.
 * It never lists or drives an existing hc pane.
 *
 *   SUPERBOT_MAC_E2E=1 node scripts/mac-e2e.mjs
 *   SUPERBOT_MAC_E2E=1 SUPERBOT_MAC_LIVE=1 node scripts/mac-e2e.mjs
 *
 * Live still refuses a takeover pane unless SUPERBOT_TEST_PANE starts with sbot-mac-.
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cli = path.join(root, 'dist', 'cli.js')
const live = process.env.SUPERBOT_MAC_LIVE === '1'
const enabled = process.env.SUPERBOT_MAC_E2E === '1'

if (!enabled) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    realE2E: false,
    reason: 'refusing to run without SUPERBOT_MAC_E2E=1',
  }, null, 2)}\n`)
  process.exit(2)
}

const state = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-mac-e2e-'))
const requestId = `sbot-mac-${Date.now()}`
const received = []
const bot = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const id = req.headers['x-superbot-message-id']
    if (received.some((item) => item.id === body.id)) {
      res.writeHead(204)
      res.end()
      return
    }
    received.push({ id: body.id, header: id, purpose: body.purpose })
    res.writeHead(204)
    res.end()
  })
})

await new Promise((resolve) => bot.listen(0, '127.0.0.1', resolve))
const botPort = bot.address().port
const env = {
  ...process.env,
  SUPERBOT_STATE: state,
  SUPERBOT_BOT_URL: `http://127.0.0.1:${botPort}/superbot`,
}
delete env.SUPERBOT_BOT_TOKEN
const serveArgs = [cli, 'serve', '--port', '0']
if (live) serveArgs.push('--live')
const child = spawn(process.execPath, serveArgs, { env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
let ready = ''
const url = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('serve did not print a url')), 10_000)
  child.stdout.on('data', (chunk) => {
    ready += chunk.toString('utf8')
    const line = ready.trim().split('\n').at(-1)
    try {
      const parsed = JSON.parse(line)
      if (parsed.url) {
        clearTimeout(timer)
        resolve(parsed.url)
      }
    } catch {
      /* wait for the url line */
    }
  })
})

const report = { realE2E: false, mode: live ? 'live' : 'dry-run', requestId, state, steps: [] }
try {
  const created = await postJson(`${url}/v1/requests`, {
    requestId,
    text: 'sbot mac acceptance, new task only',
    scope: 'temporary super-bot state, no existing pane',
    acceptance: ['tests'],
    phases: ['design'],
  })
  report.steps.push({ name: 'new-request', ticketId: created.ticketId ?? null, assignment: created.ticket?.assignments?.[0]?.status ?? null })
  const takeoverPane = live ? process.env.SUPERBOT_TEST_PANE : 'sbot-mac-test-pane'
  if (live && (!takeoverPane || !takeoverPane.startsWith('sbot-mac-'))) {
    report.steps.push({ name: 'takeover', skipped: 'live takeover requires SUPERBOT_TEST_PANE starting with sbot-mac-' })
  } else {
    const takeover = await postJson(`${url}/v1/takeover`, macSnapshot(takeoverPane))
    report.steps.push({
      name: 'takeover',
      ticketId: takeover.ticketId ?? null,
      pane: takeoverPane,
      handover: takeover.ticket?.ticket?.handover ?? null,
    })
  }
  const assignment = created.ticket?.assignments?.[0]
  if (assignment?.gbbTaskId && !live) {
    await postJson(`${url}/v1/callbacks/gbb`, {
      event: 'agent_status',
      event_id: `${requestId}-done`,
      task_id: assignment.gbbTaskId,
      status: 'done',
      ts: new Date().toISOString(),
      owner: 'grok-bot',
    })
    await postJson(`${url}/v1/evidence`, {
      assignmentId: assignment.id,
      producer: 'harness',
      checks: [{ id: 'role:design', ok: true }, { id: 'tests', ok: true }],
    })
  }
  report.steps.push({ name: 'bot-delivery', received: received.length, ids: received.map((item) => item.id) })
  report.ok = received.length > 0 || !live
} finally {
  child.kill('SIGTERM')
  await new Promise((resolve) => bot.close(resolve))
  fs.rmSync(state, { recursive: true, force: true })
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
process.exit(report.ok ? 0 : 1)

function macSnapshot(paneId) {
  return {
    schema: 'superbot.takeover.v1',
    source: { adapter: 'gbb', command: 'status', observedAt: new Date().toISOString() },
    identity: {
      paneId,
      taskId: `${paneId}-task`,
      backend: 'hc',
      origin: 'existing',
      owner: 'grok-bot',
      kind: { status: 'unknown', source: 'mac-e2e-not-hc-get', observedAt: new Date().toISOString() },
      model: { status: 'unknown', source: 'hc-get-has-no-model-field', observedAt: new Date().toISOString() },
      labelsConsistent: true,
    },
    authorization: {
      actor: 'grok-bot',
      scope: 'only the synthetic sbot-mac pane',
      allowedToContinue: true,
      acceptance: ['tests'],
    },
    work: {
      done: [],
      open: [{ key: 'mac-open-1', title: 'read-only acceptance step', role: 'design' }],
      unknown: [],
    },
    acceptancePath: 'mac e2e harness',
    repo: '/tmp/sbot-mac-repo',
    channel: 'grok-bot',
  }
}

async function postJson(target, body) {
  const response = await fetch(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json()
}
