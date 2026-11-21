/** A refusal a caller can correct. Stable `code`, short message. */
export class UserError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'UserError'
    this.code = code
  }
}
