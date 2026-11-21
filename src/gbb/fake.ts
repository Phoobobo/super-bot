import type { CapabilityProfile } from './contract.js'
import type { AdapterCall, AdapterResult, GbbAdapter } from './adapter.js'
import { kindOf } from './argv.js'
import { isAgentKind } from '../core/model.js'

export interface FakeScript {
  launch?: 'started' | 'unknown-timeout' | 'error'
  send?: 'ok' | 'unknown-timeout' | 'error'
  handover?: 'ok' | 'unknown-timeout'
  read?: 'text' | 'empty' | 'unknown-timeout'
  readText?: string
  status?: 'ok' | 'unknown-timeout'
  stop?: 'ok' | 'error'
}

/** In-memory gbb. Results are simulated and must be labeled as such. */
export class FakeGbb implements GbbAdapter {
  readonly mode = 'fake' as const
  readonly calls: AdapterCall[] = []
  constructor(
    readonly profile: CapabilityProfile,
    readonly script: FakeScript = {},
  ) {}

  launch(args: string[]): Promise<AdapterResult> {
    return Promise.resolve(this.record('launch', args, () => {
      const kind = kindOf(args)
      if (isAgentKind(kind) && !this.profile.launchKinds.includes(kind)) {
        return { outcome: 'blocked', code: 'capability', requirement: `gbb.launch.kind=${kind}`, argv: args }
      }
      if (this.script.launch === 'unknown-timeout') return { outcome: 'unknown-timeout', argv: args }
      if (this.script.launch === 'error') return { outcome: 'error', code: 'fake-error', message: 'scripted launch error', argv: args }
      const taskId = valueAfter(args, '--task')
      return { outcome: 'started', argv: args, paneId: `fake-pane-${taskId}`, taskId, simulated: true }
    }))
  }

  send(args: string[]): Promise<AdapterResult> {
    return Promise.resolve(this.record('send', args, () => {
      if (!this.profile.send) return { outcome: 'blocked', code: 'capability', requirement: 'gbb.send', argv: args }
      if (this.script.send === 'unknown-timeout') return { outcome: 'unknown-timeout', argv: args }
      if (this.script.send === 'error') return { outcome: 'error', code: 'fake-error', message: 'scripted send error', argv: args }
      return { outcome: 'ok', argv: args, simulated: true }
    }))
  }

  handover(args: string[]): Promise<AdapterResult> {
    return Promise.resolve(this.record('handover', args, () => {
      if (this.script.handover === 'unknown-timeout') return { outcome: 'unknown-timeout', argv: args }
      const pane = valueAfter(args, '--pane')
      return { outcome: 'ok', argv: args, simulated: true, body: { task_id: `ho-${pane}` } }
    }))
  }

  read(args: string[]): Promise<AdapterResult> {
    return Promise.resolve(this.record('read', args, () => {
      if (this.script.read === 'unknown-timeout') return { outcome: 'unknown-timeout', argv: args }
      if (this.script.read === 'empty') return { outcome: 'ok', argv: args, simulated: true, body: { text: '' } }
      return {
        outcome: 'ok',
        argv: args,
        simulated: true,
        body: { text: this.script.readText ?? 'observed pane context from gbb read' },
      }
    }))
  }

  status(args: string[]): Promise<AdapterResult> {
    return Promise.resolve(this.record('status', args, () => {
      if (this.script.status === 'unknown-timeout') return { outcome: 'unknown-timeout', argv: args }
      return { outcome: 'ok', argv: args, simulated: true, body: { reportedModel: null } }
    }))
  }

  stop(args: string[]): Promise<AdapterResult> {
    return Promise.resolve(this.record('stop', args, () => {
      if (this.script.stop === 'error') return { outcome: 'error', code: 'fake-error', message: 'scripted stop error', argv: args }
      return { outcome: 'ok', argv: args, simulated: true }
    }))
  }

  private record(op: AdapterCall['op'], args: string[], run: () => AdapterResult): AdapterResult {
    this.calls.push({ op, argv: [...args] })
    return run()
  }
}

function valueAfter(args: string[], flag: string): string {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] ?? '' : ''
}
