import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { LEGAL_DOCUMENTS, getLegalContent } from '@/lib/legal/documents'
import { LOCALES } from '@/lib/i18n/locales'

/**
 * The legal pages, asserted against the code they describe.
 *
 * A privacy policy is the one document in a product that is *only* worth
 * anything if it is true, and it is also the document nothing tests. That
 * combination is how this file's first defect happened: under a heading that
 * announced itself as "architectural, not policy promises", the policy said
 *
 *     "We do not store customer data in your browser's offline cache."
 *
 * while `lib/client/offline-queue.ts` cached identified customers — name,
 * email, phone, balance, recent spend — in IndexedDB for twenty-four hours,
 * because a scan can only be *served* offline if the device already knows who
 * the code belongs to. The cache is the offline counter working as designed.
 * The policy described the opposite, and described it as a guarantee.
 *
 * Nothing about that was catchable by review: both halves were correct in
 * isolation and sat in files nobody reads together. So the assertions below
 * read the implementation and fail when the prose stops matching it — the same
 * trade as `ai-data-flow.test.ts`, for the same reason.
 */

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

const OFFLINE_QUEUE = source('lib/client/offline-queue.ts')
const COUNTER = source('lib/scan/counter.ts')

/** Every section body and bullet of a document, as one searchable string. */
function textOf(document: (typeof LEGAL_DOCUMENTS)[number], locale: 'en' | 'es'): string {
  const content = getLegalContent(document, locale)
  return [
    content.intro,
    content.disclaimer ?? '',
    ...content.sections.flatMap((section) => [
      section.heading,
      ...section.body,
      ...(section.bullets ?? []),
    ]),
  ].join('\n')
}

describe('privacy policy — browser storage', () => {
  it('does not deny an offline cache that exists', () => {
    /*
     * Pinned as a denial rather than as an exact sentence, because the failure
     * mode is somebody re-adding the reassuring version in different words. If
     * the offline queue is ever genuinely emptied of customer data, this test
     * is what should be revisited — not the sentence it protects.
     */
    const cachesCustomers =
      OFFLINE_QUEUE.includes('CounterCustomer') && OFFLINE_QUEUE.includes('CUSTOMERS')
    expect(cachesCustomers, 'offline queue no longer caches customers — revisit this test').toBe(
      true
    )

    for (const locale of LOCALES) {
      const text = textOf('privacy', locale)
      expect(text, `${locale}: policy denies a cache the code has`).not.toMatch(
        /(do not|don’t|never|no)\s+(store|guardamos|almacenamos)[^.]{0,60}(offline|cach[eé])/i
      )
      expect(text, `${locale}: policy denies a cache the code has`).not.toMatch(
        /No guardamos datos de clientes/i
      )
    }
  })

  it('discloses what the till device actually keeps, and for how long', () => {
    // The TTL in prose has to track the TTL in code. Both are currently 24h.
    expect(OFFLINE_QUEUE).toMatch(/CUSTOMER_CACHE_TTL_MS\s*=\s*24 \* 60 \* 60 \* 1000/)

    expect(textOf('privacy', 'en')).toMatch(/twenty-four hours/i)
    expect(textOf('privacy', 'es')).toMatch(/veinticuatro horas/i)
  })

  it('names the categories the cache really holds', () => {
    /*
     * `CounterCustomer` is what gets written, so its fields are the disclosure
     * surface. Asserting the three that are personal data under GDPR rather
     * than the whole type: those are the ones whose omission would make the
     * policy misleading, and the rest are shop-side loyalty figures.
     */
    for (const field of ['name', 'email', 'phone']) {
      expect(COUNTER, `CounterCustomer no longer carries ${field} — revisit the policy`).toMatch(
        new RegExp(`^\\s+${field}:`, 'm')
      )
    }

    expect(textOf('privacy', 'en')).toMatch(/contact details/i)
    expect(textOf('privacy', 'es')).toMatch(/datos de contacto/i)
  })
})

describe('privacy policy — tenant isolation', () => {
  it('does not promise row-level security, which this database deliberately lacks', () => {
    /*
     * The policy used to state, under "architectural, not policy promises",
     * that "every table is scoped by row-level security in the database". It is
     * not: migration 000018 removed thirty-odd policies *on purpose*, because
     * they were written for an architecture where a browser queries Postgres
     * directly and were provably inert here — a table owner bypasses its own
     * policies unless they are forced, and none were.
     *
     * That migration's rationale is excellent and the architecture is sound.
     * The privacy policy was describing a different product, and this is the
     * third claim in that section to have done so (the offline cache and the
     * service-worker cache were the other two). Isolation is real, it is in the
     * application layer, and it is tested — which is what the policy now says.
     */
    const migration = source('db/migrations/000018_row_level_security_realignment.sql')
    expect(
      migration,
      'migration 000018 no longer disables RLS — if RLS is now real, revisit this test and the policy'
    ).toMatch(/disable row level security|WHAT ENFORCES ISOLATION NOW/i)

    for (const locale of LOCALES) {
      const text = textOf('privacy', locale)
      expect(text, `${locale}: the policy promises row-level security`).not.toMatch(
        /row[- ]level security|seguridad a nivel de fila/i
      )
    }
  })

  it('describes the isolation it actually has', () => {
    // The real mechanism, so removing the false claim did not leave a silence
    // where a guarantee used to be.
    expect(textOf('privacy', 'en')).toMatch(/never see another shop/i)
    expect(textOf('privacy', 'en')).toMatch(/membership/i)
    expect(textOf('privacy', 'es')).toMatch(/nunca puede ver los clientes de otra/i)
  })
})

describe('cookie policy', () => {
  /**
   * Every cookie name that appears anywhere in the application source.
   *
   * Both directions matter. An undisclosed cookie is the defect everybody
   * expects; a *disclosed* cookie that no longer exists is the quieter one,
   * because it reads as diligence while describing software that is gone.
   */
  const declared = (() => {
    /*
     * Walked rather than hand-listed. The first draft named the three files the
     * constants lived in, and one had already moved — the same staleness this
     * test exists to prevent, so it cannot depend on a maintained list of where
     * to look.
     *
     * Matched by *use as a cookie*, not by name: `passimo_` is also the prefix
     * of every SQL function in this database (`passimo_record_earn`,
     * `passimo_segment_count`, forty-odd more), so a prefix match reports the
     * RPC surface as undisclosed cookies. A cookie is a name bound to a
     * `*_COOKIE` constant or handed to the cookie store directly.
     */
    const COOKIE_USE =
      /(?:_COOKIE(?:\s*:\s*string)?\s*=\s*|cookies\(\)\s*\.\s*(?:set|get|delete)\(\s*|cookieStore\s*\.\s*(?:set|get|delete)\(\s*)['"`](passimo_[a-z_]+)['"`]/g

    const names = new Set<string>()
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && path !== 'lib/legal') walk(path)
        } else if (/\.tsx?$/.test(entry.name)) {
          for (const match of source(path).matchAll(COOKIE_USE)) names.add(match[1]!)
        }
      }
    }
    walk('lib')
    walk('app')
    return names
  })()

  it('names every cookie the software sets', () => {
    expect(declared.size, 'expected cookies to audit').toBeGreaterThan(0)

    for (const locale of LOCALES) {
      const text = textOf('cookies', locale)
      for (const cookie of declared) {
        expect(text, `${locale}: cookie policy does not mention ${cookie}`).toContain(cookie)
      }
    }
  })

  it('sets no cookie it has not disclosed', () => {
    const disclosed = new Set(
      [...textOf('cookies', 'en').matchAll(/`(passimo_[a-z_]+)`/g)].map((match) => match[1]!)
    )
    for (const cookie of disclosed) {
      expect(declared.has(cookie), `${cookie} is disclosed but no longer set anywhere`).toBe(true)
    }
  })
})

describe('legal surface — no invented facts', () => {
  it('states no company identity that has not been configured', () => {
    /*
     * A legal entity, a tax number and a registered address are facts about a
     * company, not strings a codebase gets to choose — and a plausible-looking
     * invented one is materially worse than a visible gap, because nobody
     * audits what already looks finished. Anything of the sort has to come
     * from configuration, so no literal belongs in the document source.
     */
    const documents = source('lib/legal/documents.ts')

    // Spanish/EU identifiers: NIF/CIF (letter + 8 digits, or 8 digits + letter)
    // and an EU VAT number. Either would be a fabricated registration.
    expect(documents, 'a tax identifier is hardcoded in the legal documents').not.toMatch(
      /\b(?:NIF|CIF|VAT)\b[:\s]*[A-Z]?\d{8}[A-Z]?/i
    )
    // A street address with a number, e.g. "Calle Mayor 12" / "12 High Street".
    expect(documents, 'a registered address is hardcoded in the legal documents').not.toMatch(
      /\b(?:C\/|Calle|Avenida|Avda\.?|Plaza)\s+\S+\s+\d/i
    )
    expect(documents, 'a company form is asserted without configuration').not.toMatch(
      /\b(?:S\.?L\.?U?\.?|S\.?A\.?|GmbH|Ltd\.?|LLC|Inc\.?)\b(?![a-z])/
    )
  })

  it('claims no certification and no compliance guarantee', () => {
    /*
     * "GDPR compliant" is a conclusion a regulator reaches, not a sentence a
     * vendor writes; ISO/SOC claims require an auditor and a report. The
     * documents are allowed to describe *behaviour* — which is what makes them
     * useful — and not to award themselves a verdict on it.
     */
    for (const document of LEGAL_DOCUMENTS) {
      for (const locale of LOCALES) {
        const text = textOf(document, locale)
        expect(text, `${document}/${locale} claims certification`).not.toMatch(
          /\b(?:ISO\s?27001|SOC\s?2|PCI[\s-]?DSS\s+(?:certified|compliant)|HIPAA[\s-]?compliant)\b/i
        )
        expect(text, `${document}/${locale} awards itself a compliance verdict`).not.toMatch(
          /\b(?:fully\s+)?(?:GDPR|RGPD)[\s-]?(?:compliant|certified|cumple\s+plenamente)\b/i
        )
      }
    }
  })
})

describe('legal surface — locale parity', () => {
  it('says the same number of things in both languages', () => {
    /*
     * Spanish is this product's default locale, so a section that exists only
     * in English is a disclosure most users never see. Counting sections and
     * bullets rather than comparing prose: translation is allowed to rephrase,
     * and not to drop a paragraph.
     */
    for (const document of LEGAL_DOCUMENTS) {
      const en = getLegalContent(document, 'en')
      const es = getLegalContent(document, 'es')

      expect(es.sections.length, `${document}: section count differs`).toBe(en.sections.length)

      en.sections.forEach((section, index) => {
        const counterpart = es.sections[index]!
        expect(
          counterpart.bullets?.length ?? 0,
          `${document} §${index + 1} ("${section.heading}"): bullet count differs`
        ).toBe(section.bullets?.length ?? 0)
        expect(
          counterpart.body.length,
          `${document} §${index + 1} ("${section.heading}"): paragraph count differs`
        ).toBe(section.body.length)
      })
    }
  })
})
