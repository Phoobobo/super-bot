/**
 * Pane ids are opaque strings printed by hc. A name prefix is not an id.
 * realE2E stays false unless a live run leaves the planned state, the script
 * did not inject the callback, and the request's own summary was delivered.
 */

export function liveTakeoverPane(value: string | undefined):
  | { ok: true; paneId: string }
  | { ok: false; reason: string } {
  if (typeof value !== 'string' || value.trim() === '') {
    return {
      ok: false,
      reason: 'live takeover needs SUPERBOT_TEST_PANE set to the pane id hc printed. This script does not list panes and does not invent one.',
    }
  }
  const paneId = value.trim()
  if (paneId.includes(' ') || paneId.startsWith('-')) {
    return { ok: false, reason: 'pane id must be a single opaque token, not a flag or a sentence' }
  }
  return { ok: true, paneId }
}

export function observeAcceptance(input: {
  mode: 'live' | 'dry-run'
  assignmentStatus?: string | null
  scriptInjectedCallback?: boolean
  engineSawCallback?: boolean
  purposes?: string[]
}): {
  realE2E: boolean
  leftPlanned: boolean
  summaryDelivered: boolean
  scriptInjectedCallback: boolean
  engineSawCallback: boolean
} {
  const purposes = input.purposes ?? []
  const summaryDelivered = purposes.includes('summary')
  const leftPlanned = input.assignmentStatus === 'running'
    || input.assignmentStatus === 'claimed'
    || input.assignmentStatus === 'accepted'
  const scriptInjectedCallback = input.scriptInjectedCallback === true
  const engineSawCallback = input.engineSawCallback === true
  const realE2E = input.mode === 'live'
    && leftPlanned
    && scriptInjectedCallback === false
    && engineSawCallback
    && summaryDelivered
  return { realE2E, leftPlanned, summaryDelivered, scriptInjectedCallback, engineSawCallback }
}
