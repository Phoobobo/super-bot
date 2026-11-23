import type { BotMessage } from './core/model.js'

export interface BotTarget {
  /** Operator-configured callback. Not a secret. */
  url: string
  /** Optional bearer token from the environment. Never written to the repo. */
  token?: string
}

export interface DeliveryReceipt {
  ok: boolean
  status: number
}

export function botTargetFromEnv(env: NodeJS.ProcessEnv = process.env): BotTarget | undefined {
  const url = env.SUPERBOT_BOT_URL
  if (!url) return undefined
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('SUPERBOT_BOT_URL must be http or https')
  }
  const token = env.SUPERBOT_BOT_TOKEN
  return { url, token: token || undefined }
}

export function deliveryBody(message: BotMessage): Record<string, unknown> {
  return {
    id: message.id,
    ticketId: message.ticketId ?? null,
    purpose: message.purpose,
    text: message.text,
    data: message.data,
  }
}

/** POST one outbox row. The message id is the idempotency key. */
export async function postBotMessage(
  target: BotTarget,
  message: BotMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryReceipt> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-superbot-message-id': message.id,
  }
  if (target.token) headers.authorization = `Bearer ${target.token}`
  const response = await fetchImpl(target.url, { method: 'POST', headers, body: JSON.stringify(deliveryBody(message)) })
  return { ok: response.ok, status: response.status }
}
