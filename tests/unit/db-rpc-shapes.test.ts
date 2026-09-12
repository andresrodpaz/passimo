import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { idsFrom } from '@/lib/db'

/**
 * Reading a list of ids out of an RPC result.
 *
 * This file exists because of a bug that raised nothing, logged nothing, and
 * broke three revenue features at once — and because the trap that caused it is
 * a property of PostgreSQL rather than of our code, so it will be laid again.
 *
 * `passimo_segment_customer_ids` is declared `returns table (id uuid)`. A
 * `returns table` with a **single** column is not a composite type in the
 * catalogue: PostgreSQL flattens it to `returns setof uuid`. `rpc()` correctly
 * hands those back as bare values. Three call sites read them as
 * `rows.map((row) => row.id)`, which on strings yields `undefined` — and
 * `.in('id', [undefined, …])` matches nothing.
 *
 * The product symptoms, none of which surfaced as an error:
 *
 *   * Customers → filter by segment returned an empty list while the segments
 *     screen said 468, because counting goes through a different function.
 *   * A segment-targeted campaign reported its reach correctly and then sent to
 *     nobody.
 *   * Birthday and anniversary automations found nobody, every day.
 */

describe('idsFrom', () => {
  it('reads a setof scalar, which is what a one-column returns table produces', () => {
    expect(idsFrom(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('reads a setof composite, which is what a multi-column one produces', () => {
    expect(idsFrom([{ id: 'a' }, { id: 'b' }])).toEqual(['a', 'b'])
  })

  it('accepts either shape from the same caller', () => {
    // The whole point: a caller cannot be wrong about which shape it is given.
    expect(idsFrom(['a', { id: 'b' }])).toEqual(['a', 'b'])
  })

  it('never yields undefined, which is what broke .in() silently', () => {
    const ids = idsFrom([{ notId: 'x' }, null, 42, undefined, { id: 'ok' }])
    expect(ids).toEqual(['ok'])
    expect(ids.every((id) => typeof id === 'string')).toBe(true)
  })

  it('treats a failed or empty RPC as an empty audience, not a crash', () => {
    expect(idsFrom(null)).toEqual([])
    expect(idsFrom(undefined)).toEqual([])
    expect(idsFrom([])).toEqual([])
    expect(idsFrom({ id: 'not-an-array' })).toEqual([])
  })
})

/**
 * The structural half.
 *
 * `idsFrom` only helps where it is used, and the failure mode is a call site
 * that looks perfectly reasonable. So this asserts that nothing in the tree
 * reads `.id` off an RPC result again — which is the actual bug, not the
 * absence of a helper.
 */
describe('no call site re-introduces the shape assumption', () => {
  const ROOT = path.resolve(__dirname, '../..')

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, out)
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full)
    }
    return out
  }

  it('nothing maps an rpc result through row.id by hand', () => {
    const offenders: string[] = []

    /*
     * Proximity, not whole-file. `.map((row) => row.id)` is perfectly correct on
     * a `.from('customers').select('id')` result — those really are one-key
     * objects — and `lib/automations/engine.ts` does exactly that a few lines
     * below the RPC that was broken. Only the lines *following an `.rpc(` call*
     * are suspect, so the window is what gets scanned.
     */
    const WINDOW = 14
    const suspect = /\.map\(\s*\(\s*row[^)]*\)\s*=>\s*row\.id\b/

    for (const file of [...walk(path.join(ROOT, 'lib')), ...walk(path.join(ROOT, 'app'))]) {
      const lines = fs.readFileSync(file, 'utf8').split('\n')

      lines.forEach((line, index) => {
        if (!line.includes('.rpc(')) return

        for (let offset = 1; offset <= WINDOW; offset += 1) {
          const candidate = lines[index + offset]
          if (candidate === undefined) break
          // Comments describe the bug on purpose; they are not the bug.
          const code = candidate.replace(/^\s*(\/\/|\*|\/\*).*$/, '')
          if (suspect.test(code)) {
            offenders.push(`${path.relative(ROOT, file)}:${index + offset + 1}`)
            break
          }
        }
      })
    }

    expect(offenders, `use idsFrom() in: ${offenders.join(', ')}`).toEqual([])
  })
})
