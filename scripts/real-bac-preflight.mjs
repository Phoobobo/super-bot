#!/usr/bin/env node
/**
 * Read-only probe of a bac binary. It does not launch, read a pane, or post a callback.
 * State and config are a fresh temporary directory, never the operator's default BAC dirs.
 * realE2E is always false. A native Bot→BAC→Herdr loop is a later command, not this one.
 *
 *   node scripts/real-bac-preflight.mjs
 *   SUPERBOT_BAC_BIN=/path/to/bac node scripts/real-bac-preflight.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const startedAt = new Date().toISOString()
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-bac-preflight-'))
const home = path.join(state, 'home')
fs.mkdirSync(path.join(home, '.config'), { recursive: true })
fs.mkdirSync(path.join(home, '.local', 'state'), { recursive: true })
fs.mkdirSync(path.join(home, '.local', 'share'), { recursive: true })

const report = {
  realE2E: false,
  launched: false,
  callbackInjected: false,
  host: os.hostname(),
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  startedAt,
  bacBin: process.env.SUPERBOT_BAC_BIN || 'bac',
  isolatedState: state,
  probes: {},
  gaps: [],
  cleaned: false,
}

function run(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      shell: false,
      env: {
        PATH: '/usr/bin:/bin',
        HOME: home,
        TMPDIR: state,
        XDG_CONFIG_HOME: path.join(home, '.config'),
        XDG_STATE_HOME: path.join(home, '.local', 'state'),
        XDG_DATA_HOME: path.join(home, '.local', 'share'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({ code: null, stdout, stderr, timedOut: true })
    }, 5000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr: `${stderr}${error.message}`, timedOut: false, spawnError: error.code ?? 'spawn-error' })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut: false })
    })
  })
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

try {
  const version = await run(report.bacBin, ['version'])
  report.probes.version = {
    code: version.code,
    timedOut: version.timedOut,
    spawnError: version.spawnError ?? null,
    json: parseJson(version.stdout),
    stderr: version.stderr.slice(0, 400),
  }
  if (version.spawnError || version.code !== 0 || report.probes.version.json?.ok !== true) {
    report.gaps.push('bac version did not return ok JSON. Set SUPERBOT_BAC_BIN to an isolated bac 1.x binary. Do not install it globally from this script.')
  } else {
    if (report.probes.version.json.contract !== 'bac.v1' || report.probes.version.json.source !== 'bot-as-collie') {
      report.gaps.push('bac version JSON is not contract bac.v1 / source bot-as-collie')
    }
    for (const command of ['capabilities', 'doctor']) {
      const result = await run(report.bacBin, [command])
      const json = parseJson(result.stdout)
      report.probes[command] = {
        code: result.code,
        timedOut: result.timedOut,
        json,
        stderr: result.stderr.slice(0, 400),
      }
    }
    const doctor = report.probes.doctor?.json
    const modules = Array.isArray(doctor?.modules) ? doctor.modules : []
    for (const id of ['herdr_tui', 'hc']) {
      const row = modules.find((item) => item.id === id)
      if (!row?.probe_ok) report.gaps.push(`${id} probe_ok is not true (${row?.reason ?? 'missing'})`)
    }
    if (!process.env.SUPERBOT_BOT_URL) report.gaps.push('SUPERBOT_BOT_URL is unset, so no Bot can receive a terminal callback')
    report.gaps.push('this command does not launch and does not wait for a native callback')
  }
} finally {
  fs.rmSync(state, { recursive: true, force: true })
  report.cleaned = !fs.existsSync(state)
  report.finishedAt = new Date().toISOString()
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
process.exit(report.probes.version?.json?.ok === true ? 0 : 2)
