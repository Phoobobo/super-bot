import type { CapabilityProfile } from './contract.js'

export type AdapterMode = 'fake' | 'dry-run' | 'live'

export interface SpawnRequest {
  bin: string
  args: string[]
  shell: false
}

export type SpawnFn = (request: SpawnRequest) => Promise<{ code: number | null; stdout: string; timedOut: boolean }>

export interface AdapterCall {
  op: 'launch' | 'send' | 'handover' | 'read' | 'status' | 'stop'
  argv: string[]
}

export type AdapterResult =
  | { outcome: 'started'; argv: string[]; paneId?: string; taskId?: string; simulated: boolean }
  | { outcome: 'planned'; argv: string[]; dryRun: true }
  | { outcome: 'blocked'; code: string; requirement?: string; argv: string[] }
  | { outcome: 'unknown-timeout'; argv: string[] }
  | { outcome: 'ok'; argv: string[]; simulated: boolean; body?: Record<string, unknown> }
  | { outcome: 'error'; code: string; message: string; argv: string[] }

export interface GbbAdapter {
  readonly mode: AdapterMode
  readonly profile: CapabilityProfile
  readonly calls: AdapterCall[]
  launch(args: string[]): Promise<AdapterResult>
  send(args: string[]): Promise<AdapterResult>
  handover(args: string[]): Promise<AdapterResult>
  read(args: string[]): Promise<AdapterResult>
  status(args: string[]): Promise<AdapterResult>
  stop(args: string[]): Promise<AdapterResult>
}
