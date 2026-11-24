import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { EffectRow, Ledger } from './core/model.js'
import { UserError } from './core/errors.js'

type Collection =
  | 'trigger'
  | 'thread'
  | 'ticket'
  | 'decision'
  | 'mandate'
  | 'assignment'
  | 'evidence'
  | 'message'
  | 'preference'
  | 'proposal'
  | 'meta'

/**
 * One SQLite file. Domain documents are JSON rows. The Engine is the only writer of
 * triggers, threads, decisions, mandates, tickets, and assignments. Effects and the
 * outbox messages are written by the effect runner inside the same transaction as the
 * engine command that queued them, or by the runner when it records an adapter result.
 */
const DOMAIN_COLLECTIONS = new Set<Collection>(['trigger', 'thread', 'ticket', 'decision', 'mandate', 'assignment', 'evidence'])

export class Store {
  readonly db: DatabaseSync
  private depth = 0
  private seq = 0
  private domainToken: symbol | undefined
  private domainOpen = 0
  private readonly releaseLock: () => void

  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true })
    this.releaseLock = acquireLock(dir)
    this.db = new DatabaseSync(path.join(dir, 'superbot.sqlite'))
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS doc (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE TABLE IF NOT EXISTS effect (
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        json TEXT NOT NULL,
        seq INTEGER NOT NULL,
        attempts INTEGER NOT NULL,
        due INTEGER NOT NULL,
        status TEXT NOT NULL,
        idempotent INTEGER NOT NULL,
        last_error TEXT,
        PRIMARY KEY (kind, key)
      );
      CREATE TABLE IF NOT EXISTS seen_callback (
        dedupe_key TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        at TEXT NOT NULL
      );
    `)
    const row = this.db.prepare('SELECT IFNULL(MAX(seq), 0) AS seq FROM effect').get() as { seq: number } | undefined
    this.seq = row?.seq ?? 0
  }

  close(): void {
    this.db.close()
    this.releaseLock()
  }

  atomic<T>(work: () => T): T {
    const outer = this.depth === 0
    if (outer) this.db.exec('BEGIN IMMEDIATE')
    this.depth += 1
    try {
      const result = work()
      this.depth -= 1
      if (outer) this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.depth -= 1
      if (outer) {
        try {
          this.db.exec('ROLLBACK')
        } catch {
          /* already rolled back */
        }
      }
      throw error
    }
  }

  get<T>(collection: Collection, id: string): T | undefined {
    const row = this.db.prepare('SELECT json FROM doc WHERE collection = ? AND id = ?').get(collection, id) as
      | { json: string }
      | undefined
    return row ? (JSON.parse(row.json) as T) : undefined
  }

  /** Engine calls this once. A second binder is refused. */
  bindDomainWriter(token: symbol): void {
    if (this.domainToken) throw new UserError('single-writer', 'domain writer already bound')
    this.domainToken = token
  }

  enterDomain(token: symbol): void {
    if (token !== this.domainToken) throw new UserError('single-writer', 'ticket 和 mandate 只能由 Engine 写')
    this.domainOpen += 1
  }

  leaveDomain(): void {
    this.domainOpen = Math.max(0, this.domainOpen - 1)
  }

  put<T>(collection: Collection, id: string, value: T): void {
    if (DOMAIN_COLLECTIONS.has(collection) && this.domainOpen === 0) {
      throw new UserError('single-writer', `${collection} 只能由 Engine 写入`)
    }
    this.db
      .prepare(
        `INSERT INTO doc (collection, id, json) VALUES (?, ?, ?)
         ON CONFLICT(collection, id) DO UPDATE SET json = excluded.json`,
      )
      .run(collection, id, JSON.stringify(value))
  }

  list<T>(collection: Collection): T[] {
    const rows = this.db.prepare('SELECT json FROM doc WHERE collection = ? ORDER BY id').all(collection) as { json: string }[]
    return rows.map((row) => JSON.parse(row.json) as T)
  }

  meta<T>(key: string): T | undefined {
    return this.get<T>('meta', key)
  }

  setMeta<T>(key: string, value: T): void {
    this.put('meta', key, value)
  }

  ledger(): Ledger {
    return this.meta<Ledger>('ledger') ?? { spent: 0, reserved: 0 }
  }

  setLedger(ledger: Ledger): void {
    this.setMeta('ledger', ledger)
  }

  paused(): boolean {
    return this.meta<boolean>('paused') === true
  }

  setPaused(paused: boolean): void {
    this.setMeta('paused', paused)
  }

  enqueueEffect(row: Omit<EffectRow, 'seq' | 'attempts' | 'due' | 'status' | 'lastError'> & { due?: number }): EffectRow {
    const existing = this.effect(row.kind, row.key)
    if (existing && (existing.status === 'waiting' || existing.status === 'running' || existing.status === 'unknown')) {
      return existing
    }
    const stored: EffectRow = {
      kind: row.kind,
      key: row.key,
      payload: row.payload,
      seq: ++this.seq,
      attempts: 0,
      due: row.due ?? Date.now(),
      status: 'waiting',
      idempotent: row.idempotent,
    }
    this.writeEffect(stored)
    return stored
  }

  effect(kind: string, key: string): EffectRow | undefined {
    const row = this.db.prepare('SELECT json FROM effect WHERE kind = ? AND key = ?').get(kind, key) as
      | { json: string }
      | undefined
    return row ? (JSON.parse(row.json) as EffectRow) : undefined
  }

  writeEffect(row: EffectRow): void {
    this.db
      .prepare(
        `INSERT INTO effect (kind, key, json, seq, attempts, due, status, idempotent, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(kind, key) DO UPDATE SET
           json = excluded.json, seq = excluded.seq, attempts = excluded.attempts,
           due = excluded.due, status = excluded.status, idempotent = excluded.idempotent,
           last_error = excluded.last_error`,
      )
      .run(row.kind, row.key, JSON.stringify(row), row.seq, row.attempts, row.due, row.status, row.idempotent ? 1 : 0, row.lastError ?? null)
  }

  /**
   * Move one waiting effect to running inside the caller's transaction.
   * A second claim of the same row returns undefined.
   */
  claimEffect(kind: string, key: string, now: number): EffectRow | undefined {
    return this.atomic(() => {
      const row = this.effect(kind, key)
      if (!row || row.status !== 'waiting' || row.due > now) return undefined
      row.status = 'running'
      row.attempts += 1
      this.writeEffect(row)
      return row
    })
  }

  nextDueEffect(now: number): EffectRow | undefined {
    const row = this.db
      .prepare(`SELECT json FROM effect WHERE status = 'waiting' AND due <= ? ORDER BY seq LIMIT 1`)
      .get(now) as { json: string } | undefined
    return row ? (JSON.parse(row.json) as EffectRow) : undefined
  }

  effects(): EffectRow[] {
    const rows = this.db.prepare('SELECT json FROM effect ORDER BY seq').all() as { json: string }[]
    return rows.map((row) => JSON.parse(row.json) as EffectRow)
  }

  seenCallback(key: string): { key: string; body: Record<string, unknown>; at: string; assignmentId?: string } | undefined {
    const row = this.db.prepare('SELECT json FROM seen_callback WHERE dedupe_key = ?').get(key) as { json: string } | undefined
    return row ? (JSON.parse(row.json) as { key: string; body: Record<string, unknown>; at: string; assignmentId?: string }) : undefined
  }

  putCallback(value: { key: string; body: Record<string, unknown>; at: string; assignmentId?: string }): void {
    this.db
      .prepare('INSERT INTO seen_callback (dedupe_key, json, at) VALUES (?, ?, ?)')
      .run(value.key, JSON.stringify(value), value.at)
  }
}

function acquireLock(dir: string): () => void {
  const file = path.join(dir, 'lock')
  try {
    const fd = fs.openSync(file, 'wx')
    fs.writeFileSync(fd, String(process.pid))
    return () => {
      fs.closeSync(fd)
      fs.rmSync(file, { force: true })
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST') throw error
    const pid = Number(fs.readFileSync(file, 'utf8'))
    if (Number.isInteger(pid) && pid > 0 && !alive(pid)) {
      fs.rmSync(file, { force: true })
      return acquireLock(dir)
    }
    throw new UserError('locked', 'state directory is already open by another super-bot process')
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
