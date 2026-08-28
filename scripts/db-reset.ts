#!/usr/bin/env node
/**
 * Drops and recreates the `public` schema, then re-runs every migration.
 *
 *   pnpm db:reset
 *
 * The point of this script is to prove the claim that a fresh PostgreSQL
 * database can initialise from this repository alone. If `db:reset` works, a
 * restore works, a new developer's first afternoon works, and CI works.
 *
 * Guarded, because "drops everything" and "one keystroke" is a bad combination:
 *
 *   1. It refuses to run when `NODE_ENV=production`.
 *   2. It refuses to run against a host that does not look like development,
 *      unless `--force` is passed *and* `CONFIRM_DESTRUCTIVE_RESET=yes` is set.
 *
 * Two independent signals rather than one, because a single `--force` is exactly
 * the flag someone copies out of a README into a terminal pointed at production.
 */

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

const DEVELOPMENT_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'postgres',
  'host.docker.internal',
])

function main(): Promise<void> {
  const force = process.argv.includes('--force')
  const url = process.env.DATABASE_URL?.trim()

  if (!url) {
    console.error('DATABASE_URL is not set. See .env.example.')
    process.exit(1)
  }

  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to reset the database with NODE_ENV=production.')
    process.exit(1)
  }

  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    console.error('DATABASE_URL could not be parsed.')
    process.exit(1)
  }

  const looksLocal = DEVELOPMENT_HOSTS.has(host)

  if (!looksLocal) {
    const confirmed = force && process.env.CONFIRM_DESTRUCTIVE_RESET === 'yes'
    if (!confirmed) {
      console.error(
        `Refusing to reset a non-local database (${host}).\n\n` +
          'This drops the public schema and everything in it. If you are certain:\n' +
          '  CONFIRM_DESTRUCTIVE_RESET=yes pnpm db:reset --force'
      )
      process.exit(1)
    }
    console.warn(`\n!! Resetting a NON-LOCAL database: ${host}\n`)
  }

  return reset(url)
}

async function reset(url: string): Promise<void> {
  const client = new Client({
    connectionString: url,
    ssl: /@(localhost|127\.0\.0\.1|\[::1\]|postgres|host\.docker\.internal)[:/]/.test(url)
      ? false
      : { rejectUnauthorized: false },
  })

  await client.connect()
  try {
    console.log('Dropping schema public …')
    /*
     * `cascade` takes the tables, the 57 plpgsql functions, the triggers and the
     * ledger with it. Recreating the schema afterwards is what makes the next
     * migration run identical to a first-ever run.
     */
    await client.query('drop schema if exists public cascade')
    await client.query('create schema public')
    console.log('Recreated empty schema public.')
  } finally {
    await client.end()
  }

  console.log('\nRe-applying migrations …\n')
  execFileSync(
    process.execPath,
    ['--experimental-strip-types', join(ROOT, 'scripts', 'migrate.ts')],
    { stdio: 'inherit', cwd: ROOT }
  )
}

await main()
