import type { RawObservation, ResolvedObservation } from '../observe.js'

/** Agent programs super-bot knows how to name. Launchability is a separate capability fact. */
export type AgentKind = 'codex' | 'pi' | 'antigravity' | 'grok'

export type Role = 'design' | 'verify' | 'execute'

/** Optional pstack protocol. Agent weights are a different preference. */
export type WorkflowKind = 'feature' | 'bugfix' | 'verify'

export interface WorkflowPolicy {
  /** off keeps the phase list. feature, bugfix, and verify are opt-in. */
  defaultKind: 'off' | WorkflowKind
  /** Extra fix attempts after an independent verify fails. Finite. */
  maxReworkRounds: number
}

export interface WorkflowBinding {
  kind: WorkflowKind
  source: 'request' | 'preference'
  policyVersion: number
  maxReworkRounds: number
  reworkRounds: number
  acceptance: string[]
  kickoffHead?: string
  acceptedHead?: string
  reproCommand?: string
  reproOutput?: string
}

export type Intensity = 'low' | 'normal' | 'high'

export const COST: Record<Intensity, number> = { low: 1, normal: 2, high: 4 }

export const AGENT_KINDS: readonly AgentKind[] = ['codex', 'pi', 'antigravity', 'grok']

export function isAgentKind(value: string | undefined): value is AgentKind {
  return value === 'codex' || value === 'pi' || value === 'antigravity' || value === 'grok'
}
export const ROLES: readonly Role[] = ['design', 'verify', 'execute']

export interface QuotaValue {
  remaining: number
  limit?: number
}

export interface Weight {
  kind: AgentKind
  weight: number
}

export interface Preference {
  version: number
  intensity: Intensity
  budget: number
  authorizedKinds: AgentKind[]
  /** Used only when pi cannot be launched. Never applied silently. */
  executeSubstitutes: AgentKind[]
  weights: Record<Role, Weight[]>
  sampleSeed: string
  unknownQuota: 'mark-and-proceed' | 'block'
  acceptMode: 'explicit-only'
  allowedActors: string[]
  workflow: WorkflowPolicy
  at: string
  note: string
}

export interface Ledger {
  spent: number
  reserved: number
}

export interface Trigger {
  id: string
  source: 'grok-bot'
  actor: string
  threadKey: string
  text: string
  scope: string
  requestId: string
  at: string
  acceptance: string[]
  acceptancePath: string
  phases: Role[]
  repo: string
  channel: string
  simulated: boolean
  /** A person's follow-up on a thread that already has a ticket. It grants no new mandate. */
  followUp: boolean
  workflow?: WorkflowKind
  head?: string
}

export interface Thread {
  key: string
  triggerIds: string[]
  /** Triggers waiting for Eval. */
  queued: string[]
  subscription?: { ticketId: string }
  decisionIds: string[]
}

export interface Decision {
  id: string
  threadKey: string
  triggerId: string
  kind: 'accept' | 'ignore' | 'stop'
  reason: string
  ticketId?: string
  policyVersion: number
  at: string
}

export interface Mandate {
  id: string
  ticketId: string
  policyVersion: number
  scope: string
  strength: 'explicit'
  actor: string
  source: 'grok-bot' | 'takeover'
  acceptance: string[]
  withdrawn: boolean
  at: string
}

export interface WorkItem {
  key: string
  title: string
  role?: Role
}

export interface UnknownItem {
  key?: string
  note: string
}

export interface Ticket {
  id: string
  threadKey: string
  mandateId: string
  title: string
  scope: string
  acceptance: string[]
  acceptancePath: string
  origin: 'request' | 'takeover'
  triggerId?: string
  channel: string
  repo: string
  owner: string
  phase: 'open' | 'ended'
  end?: { by: 'completed' | 'cancelled'; at: string; reason: string }
  assignmentIds: string[]
  doneKeys: string[]
  unknownItems: UnknownItem[]
  inputs: { id: string; text: string; at: string; sent: boolean }[]
  boundPane?: { paneId: string; taskId?: string; kind?: AgentKind }
  /** Model observation copied from a takeover snapshot. New work leaves this empty. */
  modelRaw?: import('../observe.js').RawObservation<string>
  /** True when the executor path is the fake adapter, not a machine running gbb. */
  simulated: boolean
  labelTrust: boolean
  createdAt: string
  /** Takeover only. A pasted snapshot does not set this to registered. */
  handover?: 'pending' | 'planned' | 'registered' | 'unknown'
  /** Frozen at accept. A later preference edit does not rewrite it or cancel the ticket. */
  workflow?: WorkflowBinding
  /** Takeover only. send waits until gbb read returns text. */
  contextRead?: 'pending' | 'planned' | 'read' | 'empty' | 'unknown'
  observedContext?: { source: 'gbb-read'; text: string; at: string }
}

export type AssignmentStatus =
  | 'held'
  | 'pending'
  | 'planned'
  | 'running'
  | 'blocked'
  | 'claimed'
  | 'accepted'
  | 'unknown'
  | 'skipped'
  | 'cancelled'

export interface PlanRecord {
  role: Role
  outcome: 'ready' | 'blocked'
  kind?: AgentKind
  block?: { code: string; requirement?: string; detail: string }
  model: ResolvedObservation<string>
  quota: ResolvedObservation<QuotaValue>
  sample: {
    seed: string
    roll: number
    considered: Weight[]
    excluded: { kind: AgentKind; reason: string }[]
    selection: 'primary' | 'explored' | 'user-approved-substitute' | 'bound-pane' | 'none'
  }
  estimatedCost: number
  budgetAvailable: number
  preferenceVersion: number
}

export interface Assignment {
  id: string
  ticketId: string
  role: Role
  seq: number
  itemKey?: string
  stepId?: string
  writes?: boolean
  readOnly?: boolean
  /** Head this step is allowed to accept. A different head is stale. */
  boundHead?: string
  title: string
  status: AssignmentStatus
  plan?: PlanRecord
  prompt?: string
  argv?: string[]
  gbbTaskId?: string
  paneId?: string
  /** launch starts a pane; send types into a pane already handed over. */
  transport: 'launch' | 'send' | 'none'
  claim?: { status: string; eventKey: string; text?: string; at: string }
  evidenceIds: string[]
  block?: { code: string; requirement?: string; detail: string }
  attention?: 'stuck'
  startedAt?: string
  stuckNotified?: boolean
  reservedCost?: number
  simulated: boolean
}

export interface Evidence {
  id: string
  assignmentId: string
  producer: 'harness' | 'agent'
  checks: { id: string; ok: boolean; detail?: string }[]
  at: string
  sufficient: boolean
  reason: string
  head?: string
  command?: string
  output?: string
  /** Acceptance identity. The implementer assignment id is rejected on a verify step. */
  verifier?: string
}

export interface BotMessage {
  id: string
  channel: string
  ticketId?: string
  purpose: 'acknowledgement' | 'summary' | 'attention' | 'proposal'
  text: string
  data: Record<string, unknown>
  /**
   * queued: outbox row exists.
   * deliverable: pull mode, bot may GET it.
   * delivered: push mode, the bot URL returned 2xx.
   * failed: push attempts are exhausted.
   * acked: bot confirmed it.
   */
  status: 'queued' | 'deliverable' | 'delivered' | 'failed' | 'acked'
  at: string
}

export interface EffectRow {
  kind: 'launch' | 'send' | 'handover' | 'read' | 'status' | 'stop' | 'reply'
  key: string
  payload: Record<string, unknown>
  seq: number
  attempts: number
  due: number
  status: 'waiting' | 'running' | 'done' | 'unknown' | 'cancelled' | 'dead'
  idempotent: boolean
  lastError?: string
}

export interface SeenCallback {
  key: string
  body: Record<string, unknown>
  at: string
  assignmentId?: string
}

export interface ProposalOption {
  id: string
  title: string
  impact: string
  patch: PreferencePatch
}

export interface PreferencePatch {
  intensity?: Intensity
  budget?: number
  authorizedKinds?: AgentKind[]
  executeSubstitutes?: AgentKind[]
  weights?: Record<Role, Weight[]>
  sampleSeed?: string
  unknownQuota?: Preference['unknownQuota']
  workflow?: Partial<WorkflowPolicy>
}

export interface Proposal {
  id: string
  baseVersion: number
  at: string
  changes: PreferencePatch
  recommendation: string
  options: ProposalOption[]
  status: 'open' | 'confirmed' | 'kept'
  chosen?: string
}

export interface GbbEvent {
  source?: string
  version?: string
  event: string
  event_id?: string
  task_id?: string | null
  pane_id?: string | null
  status?: string | null
  ts?: string
  owner?: string | null
  route?: string
  backend?: string
  agent_kind?: string | null
  blocked_reason?: string
  /** Present only if a caller added it. gbb 0.3.3 does not send terminal text. */
  claim?: string
}

export type ModelObservation = RawObservation<string>
export type QuotaObservation = RawObservation<QuotaValue>
