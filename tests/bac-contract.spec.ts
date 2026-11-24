import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BAC_V1, BAC_V1_COMMIT, BAC_V1_PARENT, classifyLaunchKind } from '../src/bac/contract.js'
import { assertBacBin, handoverArgs, launchArgs } from '../src/bac/argv.js'
import { callbackEventId, intakeCallback } from '../src/bac/callback.js'
import { acceptPaneId } from '../src/bac/pane.js'
import { RealBac } from '../src/bac/real.js'
import { UserError } from '../src/core/errors.js'
import { exampleSnapshot } from '../src/demo.js'
import { openRuntime } from './helpers.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../contracts/bac/v1')

function read(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'))
}

describe('frozen bac v1 consumer', () => {
  it('pins the contract commit and does not claim the binary exists', () => {
    const source = fs.readFileSync(path.join(root, 'SOURCE.txt'), 'utf8')
    expect(source).toContain(BAC_V1_COMMIT)
    expect(source).toContain(BAC_V1_PARENT)
    expect(BAC_V1_PARENT).toBe('ae859908ed07684997c786d1744e5f724f087259')
    expect(BAC_V1.runtimeImplemented).toBe(true)
    const acceptance = read('acceptance.json') as {
      ran: boolean
      environment: string
      scenarios: { id: string; delivery?: string; replay_undelivered?: boolean }[]
    }
    const restart = acceptance.scenarios.find((item) => item.id === 'restart')
    expect(restart?.replay_undelivered).toBe(false)
    expect(restart?.delivery).toBe('per_target_one_attempt_cross_target_duplicate_possible_no_restart_replay')
    expect(BAC_V1.launchKinds).toEqual(['codex', 'grok'])
    expect(acceptance.ran).toBe(false)
    expect(acceptance.environment).toBe('fixture')
  })

  it('builds launch and handover argv from the frozen command list', () => {
    const commands = read('commands.json') as { argv0: string; commands: { launch: { usage: string }; handover: { usage: string } } }
    expect(commands.argv0).toBe('bac')
    assertBacBin('bac')
    expect(() => assertBacBin('gbb')).toThrow(UserError)
    const launch = launchArgs({
      repo: '/tmp/fixture-repo',
      kind: 'grok',
      taskId: 'demo',
      owner: 'grok-bot',
      promptFile: '/tmp/prompt.txt',
    })
    expect(launch[0]).toBe('launch')
    expect(launch).toContain('--kind')
    expect(launch).toContain('grok')
    expect(commands.commands.launch.usage.startsWith('bac launch')).toBe(true)
    expect(commands.commands.handover.usage).toBe('bac handover --pane <id> [--note <text>] [--owner <name>] [--backend herdr|hc]')
    expect(handoverArgs('t9', 'grok-bot')).toEqual(['handover', '--pane', 't9', '--owner', 'grok-bot'])
    expect(handoverArgs('t9', 'grok-bot').join(' ')).not.toContain('hc ')
  })

  it('rejects omitted, pi, and antigravity kinds without rewriting them', async () => {
    const pi = read('fixtures/cli/kind-pi.json') as { body: { error: { code: string; kind: string; kind_support: string } } }
    const omitted = read('fixtures/cli/kind-omitted.json') as { body: { error: { code: string } } }
    const antigravity = read('fixtures/cli/kind-antigravity.json') as { body: { error: { kind_support: string; kind: string } } }
    expect(pi.body.error).toMatchObject({ code: 'kind_unsupported', kind: 'pi', kind_support: 'rejected' })
    expect(omitted.body.error.code).toBe('kind_required')
    expect(antigravity.body.error).toMatchObject({ kind: 'antigravity', kind_support: 'rejected' })
    const spawn = () => Promise.reject(new Error('spawned'))
    const bac = new RealBac({ mode: 'live', allowLive: true, profile: BAC_V1, spawn })
    const refused = await bac.launch(['launch', '--repo', '/tmp/fixture-repo', '--task', 'demo', '--prompt', 'say hi'])
    expect(refused).toMatchObject({ outcome: 'blocked', code: 'kind_required' })
    const piLaunch = await bac.launch(launchArgs({
      repo: '/tmp/fixture-repo', kind: 'pi', taskId: 'demo', owner: 'grok-bot', promptFile: '/tmp/p.txt',
    }))
    expect(piLaunch).toMatchObject({ outcome: 'blocked', code: 'kind_unsupported', kind: 'pi', kindSupport: 'rejected' })
    if (piLaunch.outcome === 'blocked') expect(piLaunch.argv).toContain('pi')
    expect(classifyLaunchKind('other')).toMatchObject({ code: 'kind_unsupported', kindSupport: 'unknown' })
    expect(bac.calls.every((call) => !call.argv.includes('codex') || call.argv.includes('pi'))).toBe(true)
  })

  it('accepts the frozen callback and rejects forbidden fields, a string version, and a bad pane', () => {
    const owner = read('fixtures/callbacks/owner-done.json') as { payload: Record<string, unknown> }
    expect(callbackEventId('t9', 'agent_status', 'done', 3)).toBe(owner.payload.event_id)
    expect(intakeCallback(owner.payload).ok).toBe(true)
    const pair = read('fixtures/callbacks/fallback-same-event.json') as { payloads: { event_id: string; route: string }[] }
    expect(pair.payloads[0]?.event_id).toBe(pair.payloads[1]?.event_id)
    expect(pair.payloads.map((item) => item.route)).toEqual(['owner', 'fallback'])
    const poisoned = read('fixtures/callbacks/reject-terminal-text.json') as { payload: Record<string, unknown> }
    expect(intakeCallback(poisoned.payload)).toMatchObject({ ok: false, rejected: 'forbidden_field' })
    const stringVersion = { ...owner.payload, version: '1' }
    expect(intakeCallback(stringVersion)).toMatchObject({ ok: false, rejected: 'version' })
    const oldSource = { ...owner.payload, source: 'grokbot-bridge-herdr' }
    expect(intakeCallback(oldSource)).toMatchObject({ ok: false, rejected: 'source' })
    expect(acceptPaneId('t9').ok).toBe(true)
    expect(acceptPaneId('w1:p1').ok).toBe(true)
    for (const pane of ['planned', 'pending', 'unknown', 'fake', 'placeholder']) {
      expect(acceptPaneId(pane).ok).toBe(false)
    }
    expect(acceptPaneId('sp0123456789abcdef0123456789abcdef').ok).toBe(false)
    expect(acceptPaneId('tb0123456789abcdef0123456789abcdef').ok).toBe(false)
    const spaceAsPane = { ...owner.payload, pane_id: 'sp0123456789abcdef0123456789abcdef' }
    expect(intakeCallback(spaceAsPane)).toMatchObject({ ok: false, rejected: 'pane_id' })
  })

  it('does not register a takeover whose reported kind is pi', async () => {
    const runtime = openRuntime()
    const snapshot = exampleSnapshot()
    snapshot.identity.kind = { status: 'known', value: 'pi', source: 'operator-snapshot', observedAt: snapshot.source.observedAt }
    await expect(runtime.takeover(snapshot)).rejects.toThrow(/kind pi is not implemented/)
    expect(runtime.adapter.calls.some((call) => call.op === 'handover')).toBe(false)
    runtime.close()
  })
})
