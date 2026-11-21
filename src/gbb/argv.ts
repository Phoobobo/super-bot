import type { AgentKind } from '../core/model.js'
import { UserError } from '../core/errors.js'

/** Every gbb invocation is an argument vector. Nothing is joined into a shell. */
export interface ArgvCall {
  bin: string
  args: string[]
}

export function assertGbbBin(bin: string): void {
  const base = bin.split(/[/\\]/).pop()
  if (base !== 'gbb') throw new UserError('gbb-bin', `control bin must be gbb, got ${base || bin}`)
}

export function launchArgs(input: {
  repo: string
  kind: AgentKind
  taskId: string
  owner: string
  promptFile: string
}): string[] {
  return [
    'launch',
    '--repo', input.repo,
    '--kind', input.kind,
    '--task', input.taskId,
    '--owner', input.owner,
    '--backend', 'hc',
    '--no-worktree',
    '--prompt-file', input.promptFile,
  ]
}

export function sendArgs(taskId: string, text: string): string[] {
  if (text === '--pending') throw new UserError('send-ambiguous', 'refusing to send the literal --pending')
  return ['send', taskId, text]
}

export function handoverArgs(paneId: string, owner: string): string[] {
  return ['handover', '--pane', paneId, '--owner', owner, '--backend', 'hc']
}

/** `gbb read <task> --lines N`. Read-only. Does not type into the pane. */
export function readArgs(taskId: string): string[] {
  return ['read', taskId, '--lines', '80']
}

export function statusArgs(taskId: string): string[] {
  return ['status', taskId]
}

export function stopArgs(taskId: string): string[] {
  return ['stop', taskId]
}

/** Pull `--kind` back out of an argv we built, so the adapter can refuse a kind the profile cannot launch. */
export function kindOf(args: readonly string[]): string | undefined {
  const i = args.indexOf('--kind')
  return i >= 0 ? args[i + 1] : undefined
}
