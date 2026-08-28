#!/usr/bin/env node
/**
 * The migration runner.
 *
 *   pnpm db:migrate            apply every pending migration
 *   pnpm db:migrate --status   show what is applied and what is pending
 *   pnpm db:migrate --dry-run  print the plan without touching the database
 *
 * Design constraints, each of which cost something elsewhere:
 *
 *  - **One ledger, checksummed.** `schema_migrations` records the filename and
 *    the SHA-256 of the file that was applied. A file edited after it ran is a
 *    hard failure, not a warning: a database whose ledger says "000006 applied"
 *    while 000006 on disk says something else is a database nobody can reason
 *    about, and the failure has to happen at deploy time rather than at the
 *    first query that depends on the difference.
 *
 *  - **Each migration in its own transaction.** PostgreSQL has transactional
 *    DDL, so a migration that fails halfway leaves nothing behind and the same
 *    command can be run again after the fix. The ledger insert is inside the
 *    same transaction, so "applied" and "recorded" cannot disagree.
 *
 *  - **An advisory lock around the whole run.** Railway rolls deployments: two
 *    containers can start within milliseconds of each other and both find the
 *    same migration pending. `pg_advisory_lock` makes the second one wait and
 *    then find nothing to do, instead of both running `create index` on the same
 *    table.
 *
 *  - **No down migrations.** A rollback of a schema change that has already
 *    accepted writes is a data-loss decision, and a generated `drop column` is
 *    the worst possible way to make it. Roll forward.
 *
 * Runs against any PostgreSQL 14+ server: a local container in development,
 * Railway PostgreSQL in production. Nothing here is provider-specific.
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

const MIGRATIONS_DIR = join(dirname(dirname(fileURLToPath(import.meta.url))), 'db', 'migrations')

/**
 * A fixed 64-bit key for `pg_advisory_lock`. Any constant works; it only has to
 * be the same in every instance of this script and unlikely to collide with
 * another application's lock on a shared server.
 */
const LOCK_KEY = 8_147_320_115_477_001n

type Migration = { name: string; sql: string; checksum: string }

function loadMigrations(): Migration[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort() // Zero-padded numeric prefixes make lexicographic order correct.

  return files.map((name) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8')
    return {
      name,
      sql,
      // Normalised so a checkout with CRLF line endings does not read as a
      // different file from the one that was applied on Linux.
      checksum: createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex'),
    }
  })
}

function connectionString(): string {
  const url = process.env.DATABASE_URL?.trim()
  if (!url) {
    console.error(
      'DATABASE_URL is not set.\n\n' +
        '  Development:  docker compose up -d postgres\n' +
        '                DATABASE_URL=postgresql://passimo:passimo@localhost:5432/passimo\n' +
        '  Production:   the value Railway injects when a PostgreSQL service is attached.\n\n' +
        'See .env.example.'
    )
    process.exit(1)
  }
  return url
}

function sslConfig(url: string): { rejectUnauthorized: boolean } | false {
  const explicit = process.env.DATABASE_SSL?.trim().toLowerCase()
  if (explicit === 'disable' || explicit === 'false') return false
  if (explicit === 'verify' || explicit === 'strict') return { rejectUnauthorized: true }
  if (/[?&]sslmode=disable/.test(url)) return false
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal|postgres)[:/]/.test(url)
  return isLocal ? false : { rejectUnauthorized: false }
}

const LEDGER_SQL = `
  create table if not exists schema_migrations (
    name        text primary key,
    checksum    text not null,
    applied_at  timestamptz not null default now(),
    duration_ms integer not null default 0
  )
`

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const statusOnly = args.has('--status')
  const dryRun = args.has('--dry-run')

  const url = connectionString()
  const client = new Client({ connectionString: url, ssl: sslConfig(url) })

  await client.connect()

  try {
    await client.query(LEDGER_SQL)

    const applied = new Map<string, { checksum: string; applied_at: string }>()
    const { rows } = await client.query<{ name: string; checksum: string; applied_at: string }>(
      'select name, checksum, applied_at from schema_migrations'
    )
    for (const row of rows) applied.set(row.name, row)

    const migrations = loadMigrations()

    if (migrations.length === 0) {
      console.error(`No migrations found in ${MIGRATIONS_DIR}`)
      process.exit(1)
    }

    // Drift check before anything is applied, so a tampered file stops the run
    // rather than being discovered after three later migrations have landed.
    const drifted = migrations.filter((migration) => {
      const record = applied.get(migration.name)
      return record && record.checksum !== migration.checksum
    })

    if (drifted.length > 0) {
      console.error('Migration files changed after they were applied:\n')
      for (const migration of drifted) {
        console.error(`  ${migration.name}`)
        console.error(`    applied: ${applied.get(migration.name)!.checksum.slice(0, 16)}…`)
        console.error(`    on disk: ${migration.checksum.slice(0, 16)}…`)
      }
      console.error(
        '\nMigration history is a ledger, not a source file. Add a new migration that\n' +
          'makes the change instead of editing one that has run.'
      )
      process.exit(1)
    }

    const pending = migrations.filter((migration) => !applied.has(migration.name))

    if (statusOnly) {
      console.log(`Database: ${redact(url)}`)
      console.log(`Migrations: ${migrations.length} total, ${pending.length} pending\n`)
      for (const migration of migrations) {
        const record = applied.get(migration.name)
        console.log(
          record
            ? `  [applied] ${migration.name}  ${record.applied_at}`
            : `  [pending] ${migration.name}`
        )
      }
      return
    }

    if (pending.length === 0) {
      console.log(`Database is up to date (${migrations.length} migrations applied).`)
      return
    }

    console.log(`Database: ${redact(url)}`)
    console.log(`Applying ${pending.length} migration(s):\n`)

    if (dryRun) {
      for (const migration of pending) console.log(`  would apply ${migration.name}`)
      return
    }

    /*
     * Serialise concurrent runners. Session-scoped, so it is held for the whole
     * run and released by `pg_advisory_unlock` below or by the connection
     * closing — including when this process is killed mid-deploy.
     */
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY.toString()])

    try {
      // Re-read the ledger: another runner may have completed while we waited.
      const { rows: afterLock } = await client.query<{ name: string }>(
        'select name from schema_migrations'
      )
      const nowApplied = new Set(afterLock.map((row) => row.name))

      for (const migration of pending) {
        if (nowApplied.has(migration.name)) {
          console.log(`  ${migration.name} — applied by another process, skipping`)
          continue
        }

        const startedAt = Date.now()
        process.stdout.write(`  ${migration.name} … `)

        try {
          await client.query('begin')
          await client.query(migration.sql)
          const duration = Date.now() - startedAt
          await client.query(
            'insert into schema_migrations (name, checksum, duration_ms) values ($1, $2, $3)',
            [migration.name, migration.checksum, duration]
          )
          await client.query('commit')
          console.log(`ok (${duration} ms)`)
        } catch (error) {
          await client.query('rollback').catch(() => undefined)
          console.log('failed')
          console.error(`\n${migration.name} failed and was rolled back:\n`)
          console.error(formatPgError(error))
          process.exit(1)
        }
      }
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK_KEY.toString()]).catch(() => undefined)
    }

    console.log('\nDone.')
  } finally {
    await client.end()
  }
}

/** Never print credentials, even to a developer's own terminal or to CI logs. */
function redact(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.username ? '***@' : ''}${parsed.host}${parsed.pathname}`
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}

function formatPgError(error: unknown): string {
  const pgError = error as {
    message?: string
    detail?: string
    hint?: string
    position?: string
    where?: string
  }
  const lines = [pgError.message ?? String(error)]
  if (pgError.detail) lines.push(`  detail: ${pgError.detail}`)
  if (pgError.hint) lines.push(`  hint:   ${pgError.hint}`)
  if (pgError.where) lines.push(`  where:  ${pgError.where}`)
  if (pgError.position) lines.push(`  at character ${pgError.position}`)
  return lines.join('\n')
}

await main()
