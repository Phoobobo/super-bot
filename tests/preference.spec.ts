import { afterEach, describe, expect, it } from 'vitest'
import { planAssignment } from '../src/core/plan.js'
import { defaultWeights } from '../src/preferences/defaults.js'
import { fixedQuota } from '../src/quota.js'
import { initialPreference } from '../src/preferences/defaults.js'
import { GBB_LAUNCH_KIND_V1_SIMULATED } from '../src/gbb/contract.js'
import { baseRequest, clockAt, openRuntime, stock } from './helpers.js'
import type { Runtime } from '../src/runtime.js'

const opened: Runtime[] = []
afterEach(() => {
  for (const runtime of opened) runtime.close()
  opened.length = 0
})

describe('preferences', () => {
  it('recommends, confirms, changes the next assignment, and reverts', async () => {
    const runtime = openRuntime({ profile: stock })
    opened.push(runtime)
    const before = await baseRequest(runtime, 'p1', { phases: ['execute'] })
    expect(runtime.view(before.ticketId ?? '').assignments[0]?.block?.code).toBe('capability')
    const proposal = runtime.propose({ executeSubstitutes: ['codex'], intensity: 'high', budget: 3 })
    expect(proposal.recommendation.length).toBeGreaterThan(10)
    expect(proposal.options.some((option) => option.id === 'safer')).toBe(true)
    const saved = runtime.confirm(proposal.id, 'substitutes-only')
    expect(saved.executeSubstitutes).toEqual(['codex'])
    expect(saved.intensity).toBe('normal')
    const after = await baseRequest(runtime, 'p2', { phases: ['execute'] })
    const assignment = runtime.view(after.ticketId ?? '').assignments[0]
    expect(assignment?.plan?.kind).toBe('codex')
    expect(assignment?.plan?.sample.selection).toBe('user-approved-substitute')
    expect(assignment?.simulated).toBe(true)
    runtime.revert(1)
    const reverted = await baseRequest(runtime, 'p3', { phases: ['execute'] })
    expect(runtime.view(reverted.ticketId ?? '').assignments[0]?.block?.code).toBe('capability')
  })

  it('blocks when the local budget cannot cover the phase', async () => {
    const runtime = openRuntime()
    opened.push(runtime)
    const proposal = runtime.propose({ budget: 0 })
    runtime.confirm(proposal.id, 'apply')
    const created = await baseRequest(runtime, 'budget', { phases: ['design'] })
    const assignment = runtime.view(created.ticketId ?? '').assignments[0]
    expect(assignment?.block?.code).toBe('budget_insufficient')
    expect(runtime.adapter.calls.some((call) => call.op === 'launch')).toBe(false)
  })

  it('records expired quota without using the number, and skips exploration when quota is unknown', () => {
    const preference = initialPreference('2026-01-01T00:00:00.000Z')
    const expired = planAssignment({
      role: 'design',
      ticketId: 'tck_quota',
      preference,
      profile: GBB_LAUNCH_KIND_V1_SIMULATED,
      modelRaw: { status: 'unknown', source: 'hc-get-has-no-model-field', observedAt: preference.at },
      quotaRaw: {
        status: 'known',
        value: { remaining: 0 },
        source: 'file-fixture',
        observedAt: '2026-01-01T00:00:00.000Z',
        freshUntil: '2026-01-01T00:00:01.000Z',
      },
      budgetAvailable: 20,
      nowMs: Date.parse('2026-01-02T00:00:00.000Z'),
    })
    expect(expired.quota.status).toBe('expired')
    expect(expired.quota.usable).toBe(false)
    expect(expired.outcome).toBe('ready')
    expect(expired.kind).toBe('codex')
    expect(expired.sample.excluded.some((item) => item.reason === 'quota-expired')).toBe(true)

    const unknown = planAssignment({
      role: 'design',
      ticketId: 'tck_unknown',
      preference,
      profile: GBB_LAUNCH_KIND_V1_SIMULATED,
      modelRaw: { status: 'unknown', source: 'hc-get-has-no-model-field' },
      quotaRaw: { status: 'unknown', source: 'no-quota-channel', observedAt: preference.at },
      budgetAvailable: 20,
      nowMs: Date.parse(preference.at),
    })
    expect(unknown.model.status).toBe('unknown')
    expect(unknown.sample.excluded.map((item) => item.kind).sort()).toEqual(['antigravity', 'grok'])
    expect(unknown.kind).toBe('codex')

    const fresh = {
      ...preference,
      weights: {
        ...defaultWeights(),
        design: [
          { kind: 'codex' as const, weight: 0 },
          { kind: 'grok' as const, weight: 1 },
        ],
      },
    }
    const quota = {
      status: 'known' as const,
      value: { remaining: 100 },
      source: 'file-fixture',
      observedAt: preference.at,
      freshUntil: '2026-02-01T00:00:00.000Z',
    }
    const once = planAssignment({
      role: 'design',
      ticketId: 'tck_seed',
      preference: fresh,
      profile: GBB_LAUNCH_KIND_V1_SIMULATED,
      modelRaw: { status: 'unknown', source: 'hc-get-has-no-model-field', observedAt: preference.at },
      quotaRaw: quota,
      budgetAvailable: 20,
      nowMs: Date.parse(preference.at),
    })
    const twice = planAssignment({
      role: 'design',
      ticketId: 'tck_seed',
      preference: fresh,
      profile: GBB_LAUNCH_KIND_V1_SIMULATED,
      modelRaw: { status: 'unknown', source: 'hc-get-has-no-model-field', observedAt: preference.at },
      quotaRaw: quota,
      budgetAvailable: 20,
      nowMs: Date.parse(preference.at),
    })
    expect(once.kind).toBe(twice.kind)
    expect(once.sample.roll).toBe(twice.sample.roll)
    expect(once.kind).toBe('grok')
  })

  it('blocks when the preference says an unusable quota must stop the work', async () => {
    const runtime = openRuntime({
      quota: fixedQuota({ status: 'unknown', source: 'no-quota-channel', observedAt: '2026-01-01T00:00:00.000Z' }),
      clock: clockAt(),
    })
    opened.push(runtime)
    runtime.confirm(runtime.propose({ unknownQuota: 'block' }).id, 'apply')
    const created = await baseRequest(runtime, 'quota-block', { phases: ['design'] })
    expect(runtime.view(created.ticketId ?? '').assignments[0]?.block?.code).toBe('quota_unknown')
  })
})
