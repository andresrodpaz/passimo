/**
 * Runs every diagnostic in `scripts/db/` and exits non-zero on any FAIL.
 *
 *   pnpm db:verify              # summary only
 *   pnpm db:verify --verbose    # every row of every query
 *   pnpm db:verify 014          # just the tenant-isolation file
 *
 * Why a runner rather than `for f in scripts/db/*.sql; do psql -f $f; done`:
 * that pipeline is fine for reading and useless for CI. It exits 0 whatever the
 * queries returned, because a query that reports `FAIL` in a column is still a
 * successful query. This reads the `status` column the files are written to
 * produce and turns it into an exit code, which is the only form a build gate
 * can act on.
 *
 * Uses the same `pg` pool the application uses, so it needs no `psql` on the host
 * — the local database runs in Docker and `psql` may not exist outside it.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'

const DIR = join(process.cwd(), 'scripts', 'db')
const VERBOSE = process.argv.includes('--verbose')
const FILTER = process.argv.slice(2).filter((argument) => !argument.startsWith('--'))

const C = {
  reset: '[0m',
  dim: '[2m',
  red: '[31m',
  green: '[32m',
  yellow: '[33m',
  cyan: '[36m',
  bold: '[1m',
}

type Verdict = { file: string; label: string; status: string; detail: string }

/**
 * Splits a psql script into statements.
 *
 * `\echo` and `\pset` are psql client commands, not SQL, so they are stripped
 * rather than sent — the section headings they print are recovered from the
 * comment above each statement instead, which is more useful anyway because it
 * survives a statement being moved.
 *
 * Splitting on `;` at the end of a line is deliberate rather than lazy: the only
 * semicolons inside these files that are not statement terminators are in `do $$`
 * blocks and string literals, and both are handled by requiring the semicolon to
 * be the last non-whitespace character on its line, which no `do` block body
 * satisfies at its own nesting level. If that ever stops being true the parse
 * fails loudly rather than silently running half a statement.
 */
function statementsOf(sql: string): Array<{ heading: string; text: string }> {
  const lines = sql.split(/\r?\n/)
  const statements: Array<{ heading: string; text: string }> = []

  let heading = ''
  let pendingHeading = ''
  let buffer: string[] = []
  let inDollarBlock = false

  const flush = () => {
    const text = buffer.join('\n').trim()
    buffer = []
    if (text.length === 0) return
    statements.push({ heading: heading || 'unlabelled', text })
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('\\echo')) {
      // `\echo '=== Section ==='` — keep the words, drop the decoration.
      const match = trimmed.match(/'(.*)'/)
      if (match) {
        pendingHeading = match[1].replace(/=+$/, '').replace(/^-+/, '').trim()
      }
      continue
    }
    if (trimmed.startsWith('\\')) continue
    if (trimmed.startsWith('--') && buffer.length === 0) continue
    /*
     * A blank line before a statement must not enter the buffer. Pushing it made
     * `buffer.length` non-zero, so the heading-assignment test below never fired
     * and every check in the report came back labelled "unlabelled".
     */
    if (trimmed.length === 0 && buffer.length === 0) continue

    if (/\$\$/.test(trimmed)) inDollarBlock = !inDollarBlock

    if (buffer.length === 0 && trimmed.length > 0 && pendingHeading) {
      heading = pendingHeading
      pendingHeading = ''
    }

    buffer.push(line)

    if (!inDollarBlock && /;\s*$/.test(trimmed)) flush()
  }
  flush()

  return statements
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    process.stdout.write(
      `${C.red}DATABASE_URL is not set.${C.reset} Start the database with \`pnpm db:up\` and make sure .env is present.\n`
    )
    process.exitCode = 1
    return
  }

  const files = readdirSync(DIR)
    .filter((name) => name.endsWith('.sql'))
    .filter((name) => FILTER.length === 0 || FILTER.some((f) => name.includes(f)))
    .sort()

  if (files.length === 0) {
    process.stdout.write(`No matching files in scripts/db/${FILTER.length ? ` for ${FILTER.join(', ')}` : ''}\n`)
    process.exitCode = 1
    return
  }

  const pool = new Pool({ connectionString: url, max: 2 })
  const verdicts: Verdict[] = []
  let queriesRun = 0
  let queryErrors = 0

  process.stdout.write(`${C.bold}Passimo database verification${C.reset}\n`)

  for (const file of files) {
    process.stdout.write(`\n${C.bold}${C.cyan}${file}${C.reset}\n`)
    const sql = readFileSync(join(DIR, file), 'utf8')

    for (const statement of statementsOf(sql)) {
      let result
      try {
        result = await pool.query(statement.text)
        queriesRun += 1
      } catch (cause) {
        queryErrors += 1
        verdicts.push({
          file,
          label: statement.heading,
          status: 'ERROR',
          detail: (cause as Error).message,
        })
        process.stdout.write(`  ${C.red}ERROR${C.reset}  ${statement.heading} ${C.dim}— ${(cause as Error).message}${C.reset}\n`)
        continue
      }

      const rows = Array.isArray(result) ? result.flatMap((r) => r.rows ?? []) : (result.rows ?? [])
      const statusRows = rows.filter(
        (row) => typeof row === 'object' && row !== null && 'status' in row
      )

      for (const row of statusRows) {
        const status = String((row as Record<string, unknown>).status)
        const detail = Object.entries(row as Record<string, unknown>)
          .filter(([key]) => key !== 'status')
          .map(([key, value]) => `${key}=${value === null ? 'null' : String(value)}`)
          .join(' ')
        verdicts.push({ file, label: statement.heading, status, detail })

        const colour =
          status === 'PASS' ? C.green : status === 'FAIL' ? C.red : status === 'INFO' ? C.dim : C.yellow
        process.stdout.write(
          `  ${colour}${status.padEnd(7)}${C.reset}${statement.heading}${detail ? ` ${C.dim}— ${detail}${C.reset}` : ''}\n`
        )
      }

      if (VERBOSE && rows.length > 0 && statusRows.length === 0) {
        process.stdout.write(`  ${C.dim}${statement.heading}: ${rows.length} row(s)${C.reset}\n`)
        for (const row of rows.slice(0, 20)) {
          process.stdout.write(`    ${C.dim}${JSON.stringify(row)}${C.reset}\n`)
        }
      }
    }
  }

  await pool.end()

  const counts = { PASS: 0, WARNING: 0, FAIL: 0, ERROR: 0, INFO: 0 } as Record<string, number>
  for (const verdict of verdicts) counts[verdict.status] = (counts[verdict.status] ?? 0) + 1

  process.stdout.write(`\n${C.bold}Summary${C.reset}\n`)
  process.stdout.write(
    `  ${files.length} files, ${queriesRun} queries` +
      (queryErrors > 0 ? `, ${queryErrors} failed to execute` : '') +
      `\n` +
      `  ${C.green}${counts.PASS ?? 0} pass${C.reset}   ` +
      `${C.yellow}${counts.WARNING ?? 0} warning${C.reset}   ` +
      `${(counts.FAIL ?? 0) + (counts.ERROR ?? 0) ? C.red : C.dim}${counts.FAIL ?? 0} fail${C.reset}   ` +
      `${counts.ERROR ?? 0 ? C.red : C.dim}${counts.ERROR ?? 0} error${C.reset}\n`
  )

  const bad = verdicts.filter((v) => v.status === 'FAIL' || v.status === 'ERROR')
  if (bad.length > 0) {
    process.stdout.write(`\n${C.red}${C.bold}Needs attention${C.reset}\n`)
    for (const verdict of bad) {
      process.stdout.write(`  ${C.red}✗${C.reset} [${verdict.file}] ${verdict.label} — ${verdict.detail}\n`)
    }
  }

  const warnings = verdicts.filter((v) => v.status === 'WARNING')
  if (warnings.length > 0) {
    process.stdout.write(`\n${C.yellow}Warnings${C.reset}\n`)
    for (const verdict of warnings) {
      process.stdout.write(`  ${C.yellow}!${C.reset} [${verdict.file}] ${verdict.label} — ${verdict.detail}\n`)
    }
  }

  /*
   * WARNING does not fail the run. A warning is "a human should look at this" —
   * an unbranded workspace, a customer with no phone number — and gating a build
   * on those would train everybody to pass `--force`.
   */
  process.exitCode = bad.length > 0 ? 1 : 0
}

main().catch((cause) => {
  process.stdout.write(`\n${C.red}Runner failed:${C.reset} ${(cause as Error).stack}\n`)
  process.exitCode = 1
})
