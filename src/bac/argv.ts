import type { AgentKind } from '../core/model.js'
import { UserError } from '../core/errors.js'

/** Every bac invocation is an argument vector. Nothing is joined into a shell. The bin name is not an alias of gbb. */
export function assertBacBin(bin: string): void {
  const base = bin.split(/[/\\]/).pop()
  if (base !== 'bac') throw new UserError('bac-bin', `control bin must be bac, got ${base || bin}`)
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
    '--no-worktree',
    '--prompt-file', input.promptFile,
  ]
}

export function sendArgs(taskId: string, text: string, owner: string): string[] {
  if (text === '--pending') throw new UserError('send-ambiguous', 'refusing to send the literal --pending')
  return ['send', taskId, '--owner', owner, text]
}

export function handoverArgs(paneId: string, owner: string): string[] {
  return ['handover', '--pane', paneId, '--owner', owner]
}

export function readArgs(taskId: string, owner: string): string[] {
  return ['read', taskId, '--owner', owner, '--lines', '80']
}

export function statusArgs(taskId: string, owner: string): string[] {
  return ['status', taskId, '--owner', owner]
}

export function stopArgs(taskId: string, owner: string): string[] {
  return ['stop', taskId, '--owner', owner]
}

export function kindOf(args: readonly string[]): string | undefined {
  const index = args.indexOf('--kind')
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) return undefined
  return value
}
