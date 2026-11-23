import { describe, expect, it } from 'vitest'
import { liveTakeoverPane, observeAcceptance } from '../src/mac/harness-policy.js'

describe('mac harness policy', () => {
  it('accepts an opaque hc pane id and does not require a name prefix', () => {
    expect(liveTakeoverPane('').ok).toBe(false)
    expect(liveTakeoverPane('  ').ok).toBe(false)
    const hc = liveTakeoverPane('p_8f2c91')
    expect(hc).toEqual({ ok: true, paneId: 'p_8f2c91' })
    expect(liveTakeoverPane('term-9f3a').ok).toBe(true)
    expect(liveTakeoverPane('--pane').ok).toBe(false)
  })

  it('does not call a planned launch or a script-injected callback an E2E', () => {
    const dry = observeAcceptance({
      mode: 'dry-run',
      assignmentStatus: 'planned',
      scriptInjectedCallback: true,
      engineSawCallback: false,
      purposes: ['acknowledgement', 'summary'],
    })
    expect(dry.realE2E).toBe(false)
    expect(dry.summaryDelivered).toBe(true)
    expect(dry.leftPlanned).toBe(false)

    const ackOnly = observeAcceptance({
      mode: 'live',
      assignmentStatus: 'planned',
      scriptInjectedCallback: false,
      engineSawCallback: false,
      purposes: ['acknowledgement'],
    })
    expect(ackOnly.realE2E).toBe(false)

    const live = observeAcceptance({
      mode: 'live',
      assignmentStatus: 'claimed',
      scriptInjectedCallback: false,
      engineSawCallback: true,
      purposes: ['acknowledgement', 'summary'],
    })
    expect(live.realE2E).toBe(true)
  })
})
