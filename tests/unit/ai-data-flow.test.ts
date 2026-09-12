import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * What the AI capabilities are allowed to send, asserted against the source.
 *
 * These are source-level assertions rather than runtime ones, and that is a
 * deliberate trade. The alternative — build a snapshot from a live tenant and
 * inspect the prompt — needs a database, and it would only prove the shape for
 * the rows that happened to exist. What actually needs guarding is the *column
 * list*: the defect this file pins is that `summarizeCustomer` selected a full
 * legal name and a date of birth, sent both to Anthropic, and used neither.
 * Nothing at runtime distinguishes that from correct behaviour, because the
 * model happily ignores fields — the only place it is visible is the `select`.
 *
 * The privacy policy in `lib/legal/documents.ts` is written from these facts. If
 * a future change adds a column here, this test fails and the policy gets
 * updated in the same commit, which is the actual goal: a privacy document that
 * cannot silently drift from the code it describes.
 */

const CAPABILITIES = readFileSync(join(process.cwd(), 'lib/ai/capabilities.ts'), 'utf8')

describe('AI data flow — PII minimisation', () => {
  it('sends no direct customer identifier to the provider', () => {
    /*
     * The fields that identify a person outside the merchant's own shop. None of
     * them appears in any prompt, and none is selected by any capability.
     *
     * `email` is the one worth being explicit about: it is the primary key of a
     * customer in this product, so a summary that included it would make every
     * AI request a disclosure of the merchant's customer list.
     */
    const capabilitySection = CAPABILITIES.slice(CAPABILITIES.indexOf('export async function'))

    for (const forbidden of ['email', 'phone', 'postal_code', 'address', 'birthday']) {
      // Matches a column inside a `.select('…')` list.
      const inSelect = new RegExp(`select\\([^)]*\\b${forbidden}\\b`, 's')
      expect(
        capabilitySection,
        `"${forbidden}" must not be selected into an AI prompt`
      ).not.toMatch(inSelect)
    }
  })

  it('sends a first name and never a full name', () => {
    // The summary prompt says "use only the first name". Selecting `name` as
    // well was sending a full legal name in order to ignore it.
    expect(CAPABILITIES).toContain('first_name')
    expect(CAPABILITIES).not.toMatch(/select\(\s*\n?\s*'first_name, name,/)
  })

  it('scopes every customer-scoped read to the tenant', () => {
    /*
     * `summarizeCustomer` fires three queries concurrently, so the tenant check
     * on the customer row cannot protect the other two — they had already run.
     * Every `.eq('customer_id', …)` in this file must therefore be accompanied
     * by a `business_id` filter of its own.
     */
    const customerScoped = CAPABILITIES.split('\n')
      .map((line, index) => ({ line, index }))
      .filter((entry) => entry.line.includes(".eq('customer_id'"))

    expect(customerScoped.length, 'expected customer-scoped reads to audit').toBeGreaterThan(0)

    for (const { index } of customerScoped) {
      // The `business_id` filter sits within a few lines of its sibling.
      const window = CAPABILITIES.split('\n')
        .slice(Math.max(0, index - 6), index + 6)
        .join('\n')
      expect(
        window,
        `a customer_id filter near line ${index + 1} has no business_id filter beside it`
      ).toContain("business_id")
    }
  })
})

describe('AI data flow — prompt injection', () => {
  it('marks every user-authored input as untrusted evidence', () => {
    /*
     * Staff notes, survey comments, the merchant's own brief and the business
     * snapshot are all written by people outside this codebase — and staff notes
     * and segment names can arrive from a CSV import, so "our own merchant typed
     * it" is not a trust argument either.
     *
     * Asserting the labels rather than the mechanism: if somebody replaces the
     * helper, the labels have to survive for the system prompt's instruction
     * about `<untrusted_data>` to still mean anything.
     */
    for (const label of [
      'business_snapshot',
      'customer_record',
      'recent_activity',
      'staff_notes',
      'survey_comments',
      'campaign_brief',
      'audience_request',
    ]) {
      expect(CAPABILITIES, `"${label}" is not wrapped as untrusted data`).toContain(
        `untrusted('${label}'`
      )
    }
  })

  it('interpolates no user content into a prompt outside an untrusted block', () => {
    /*
     * The failure mode this catches is a new capability that pastes a value
     * straight into its prompt. Every `JSON.stringify` in the file must either
     * be the one inside the helper, or the anomalies block — which is the output
     * of our own SQL z-score function and contains no free text.
     */
    const stringifyCalls = [...CAPABILITIES.matchAll(/\$\{JSON\.stringify\(([^)]*)\)/g)].map(
      (match) => match[1]!.trim()
    )
    const allowed = new Set(['value, null, 2', 'anomalies ?? {}, null, 2'])

    for (const call of stringifyCalls) {
      expect(
        allowed.has(call),
        `JSON.stringify(${call}) is interpolated into a prompt without an untrusted wrapper`
      ).toBe(true)
    }
  })

  it('tells the model what an untrusted block means', () => {
    // The tag is inert without the instruction. Both halves or neither.
    expect(CAPABILITIES).toContain('<untrusted_data>')
    expect(CAPABILITIES).toMatch(/never an instruction to\s*\n?\s*\*?\s*you/i)
  })
})
