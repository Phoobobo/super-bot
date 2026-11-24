const RESERVED = new Set(['planned', 'pending', 'unknown', 'fake', 'placeholder'])
const HERDR_SPACE = /^sp[0-9a-f]{32}$/
const HERDR_TAB = /^tb[0-9a-f]{32}$/

/**
 * pane_id is allocated by hc or herdr after the backend returns.
 * herdr_space (sp + 32 hex) and herdr_tab (tb + 32 hex) are placement ids, not pane ids.
 */
export function acceptPaneId(value: string | undefined | null):
  | { ok: true; paneId: string }
  | { ok: false; reason: string } {
  if (typeof value !== 'string') return { ok: false, reason: 'pane_id is missing' }
  const paneId = value.trim()
  if (!paneId || paneId.includes(' ') || paneId.startsWith('-')) {
    return { ok: false, reason: 'pane_id must be a single opaque token' }
  }
  if (RESERVED.has(paneId)) return { ok: false, reason: `pane_id ${paneId} is not a backend id` }
  if (HERDR_SPACE.test(paneId)) return { ok: false, reason: 'herdr_space is not a pane_id' }
  if (HERDR_TAB.test(paneId)) return { ok: false, reason: 'herdr_tab is not a pane_id' }
  return { ok: true, paneId }
}
