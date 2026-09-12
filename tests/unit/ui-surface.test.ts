import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Two whole-surface sweeps, run as tests.
 *
 * Both exist because of defects that were invisible to every other check in
 * this repository. TypeScript verifies that a translation key exists; it cannot
 * notice a string that never asked for one. The router serves whatever `app/`
 * contains; it cannot notice a `<Link>` to a page nobody built. So the failure
 * mode in both cases is a merchant or a customer finding it first — and the two
 * that actually shipped were `/pricing` (linked from the landing page, 404) and
 * "Add to Apple Wallet" (hardcoded English, on a customer's own loyalty card,
 * in a product whose default locale is Spanish).
 *
 * Checking the surface rather than the instance is the point. A test for those
 * two strings would have proved nothing about the next one.
 */

const ROOT = process.cwd()

function walk(dir: string, extension: RegExp, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, extension, out)
    else if (extension.test(entry.name)) out.push(path)
  }
  return out
}

const TSX = walk(join(ROOT, 'app'), /\.tsx$/).concat(walk(join(ROOT, 'components'), /\.tsx$/))

describe('every internal link goes somewhere', () => {
  /** Every URL path the App Router can serve, from the directory tree. */
  function declaredRoutes(dir: string, prefix = '', out = new Set<string>()): Set<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        if (/^(page|route)\.tsx?$/.test(entry.name)) out.add(prefix || '/')
        continue
      }
      // A route group — `(marketing)` — is organisational and not in the URL.
      const segment = /^\(.+\)$/.test(entry.name) ? '' : `/${entry.name}`
      declaredRoutes(join(dir, entry.name), prefix + segment, out)
    }
    return out
  }

  const routes = [...declaredRoutes(join(ROOT, 'app'))]

  /**
   * Paths served by `middleware.ts` rather than by a file. These are the
   * canonical redirects added when `/pricing` turned out to 404 — they are real
   * URLs with no directory, so the tree cannot see them.
   */
  const middlewareRedirects = (() => {
    const source = readFileSync(join(ROOT, 'middleware.ts'), 'utf8')
    const block = source.slice(source.indexOf('CANONICAL_REDIRECTS'))
    return [...block.matchAll(/'(\/[a-z-]*)'\s*:/g)].map((match) => match[1]!)
  })()

  function routable(path: string): boolean {
    const clean = path.split('?')[0]!.split('#')[0]!.replace(/\/+$/, '') || '/'
    if (middlewareRedirects.includes(clean)) return true
    return routes.some((route) => {
      const pattern = route
        .replace(/\[\.\.\.[^\]]+\]/g, '.+')
        .replace(/\[[^\]]+\]/g, '[^/]+')
      return new RegExp(`^${pattern}$`).test(clean)
    })
  }

  it('has routes to serve every literal href', () => {
    expect(routes.length, 'expected routes to audit').toBeGreaterThan(50)

    const dead: string[] = []
    for (const file of TSX) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/href=(?:"|'|\{')(\/[^"'`{}\s]*)(?:"|')/g)) {
        const path = match[1]!
        // Interpolated paths are not literals; `/api/**` is covered over HTTP
        // by `scripts/verify-functional.mjs`, which can see the methods too.
        if (path.includes('$') || path.startsWith('/api/')) continue
        if (!routable(path)) dead.push(`${relative(ROOT, file)} → ${path}`)
      }
    }

    expect(dead, `dead internal links:\n${dead.join('\n')}`).toEqual([])
  })

  it('redirects the canonical paths it promises', () => {
    // The redirect table is the fix for the /pricing 404. If somebody removes a
    // row, the link that depends on it starts 404ing again — silently.
    for (const path of ['/pricing', '/terms', '/privacy', '/cookies']) {
      expect(middlewareRedirects, `${path} is no longer redirected`).toContain(path)
    }
  })
})

describe('no user-facing string skips the dictionary', () => {
  /**
   * Component-library primitives that are present but rendered nowhere. Their
   * screen-reader labels are unreachable, so localising them would be busywork
   * — but they are listed by name rather than skipped by directory, because
   * `components/ui` also holds `dialog` and `sheet`, which *do* ship and whose
   * "Close" labels were unlocalised until this sweep found them.
   *
   * If one of these gets used, delete its line and localise the string.
   */
  const UNRENDERED = ['breadcrumb.tsx', 'carousel.tsx', 'pagination.tsx', 'sidebar.tsx', 'spinner.tsx']

  /** Words that make a string prose rather than an identifier or a token. */
  const PROSE =
    /\b(the|your|a|an|and|or|to|for|with|you|we|is|are|no|not|this|that|of|in|on|at|from|by|it|all|add|new|save|cancel|delete|edit|back|next|done|close|open|send|search|loading|error|failed|try|again|yet|more|less|show|hide|copy|copied|select|choose|remove|create|update)\b/i

  const BRANDS =
    /^(Passimo|Apple|Google|Apple Wallet|Google Wallet|Stripe|Anthropic|Twilio|Resend|Meta|WhatsApp|SMS|QR|CSV|PDF|API|AI|EUR|USD|GBP)$/i

  function needsTranslation(raw: string): boolean {
    const text = raw.trim()
    if (text.length < 3) return false
    if (BRANDS.test(text)) return false
    // Punctuation, numbers, units, HTML entities — nothing to translate.
    if (/^[\s\d.,:;•·—–\-/%€$£+()[\]{}<>|&@#*'"?!]+$/.test(text)) return false
    if (/^&[a-z]+;$/.test(text)) return false
    return PROSE.test(text)
  }

  it('routes every rendered string through t()', () => {
    const findings: string[] = []

    for (const file of TSX) {
      if (UNRENDERED.some((name) => file.endsWith(name))) continue

      const source = readFileSync(file, 'utf8')
      source.split('\n').forEach((line, index) => {
        const trimmed = line.trim()
        if (
          trimmed.startsWith('//') ||
          trimmed.startsWith('*') ||
          trimmed.startsWith('/*') ||
          trimmed.startsWith('import ')
        ) {
          return
        }

        // Text between tags, on one line.
        for (const match of line.matchAll(/>([^<>{}\n]{3,})</g)) {
          if (needsTranslation(match[1]!)) {
            findings.push(`${relative(ROOT, file)}:${index + 1} — "${match[1]!.trim()}"`)
          }
        }

        // The attributes a person reads or hears.
        for (const match of line.matchAll(
          /\b(placeholder|aria-label|title|alt)=(?:"([^"]{3,})"|'([^']{3,})')/g
        )) {
          const text = match[2] ?? match[3]!
          if (needsTranslation(text)) {
            findings.push(`${relative(ROOT, file)}:${index + 1} [${match[1]}] — "${text}"`)
          }
        }
      })
    }

    expect(
      findings,
      `hardcoded user-facing strings:\n${findings.join('\n')}`
    ).toEqual([])
  })

  it('keeps the two dialog primitives that do ship localised', () => {
    // Named explicitly: these were the real findings, and the allowlist above
    // is close enough to them that a careless edit could hide a regression.
    for (const file of ['components/ui/dialog.tsx', 'components/ui/sheet.tsx']) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      expect(source, `${file} lost its translated close label`).toContain("t('common.close')")
      expect(source, `${file} has a hardcoded close label again`).not.toContain(
        '<span className="sr-only">Close</span>'
      )
    }
  })
})
