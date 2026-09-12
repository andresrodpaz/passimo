import { describe, expect, it } from 'vitest'
import { normalizeTagNames } from '@/lib/customers/tags'

/**
 * Tag normalisation.
 *
 * Tags are free text typed at a counter, which means they arrive with stray
 * whitespace and inconsistent capitalisation — and a tag list is only worth
 * filtering by if "Wholesale", "wholesale" and " wholesale " are one thing.
 *
 * The rules are enforced here rather than by a database constraint because the
 * merchant's own capitalisation is what should be *stored*: `tags` is unique on
 * `(business_id, name)`, so folding at write time would make the first spelling
 * win permanently and silently rename the tag for everybody else.
 */
describe('normalizeTagNames', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeTagNames(['  wholesale  ', 'no   nuts'])).toEqual(['wholesale', 'no nuts'])
  })

  it('treats case as the same tag and keeps the first spelling', () => {
    // Not lower-cased: the merchant typed "Wholesale" and that is what their
    // customers' profiles should read.
    expect(normalizeTagNames(['Wholesale', 'wholesale', 'WHOLESALE'])).toEqual(['Wholesale'])
  })

  it('drops empty and whitespace-only entries', () => {
    expect(normalizeTagNames(['', '   ', 'real'])).toEqual(['real'])
  })

  it('caps the length of a single tag', () => {
    const long = 'x'.repeat(200)
    expect(normalizeTagNames([long])[0]).toHaveLength(60)
  })

  it('caps how many tags one customer can carry', () => {
    const many = Array.from({ length: 50 }, (_, index) => `tag-${index}`)
    expect(normalizeTagNames(many)).toHaveLength(20)
  })

  it('returns an empty list for an empty instruction, which means "clear them"', () => {
    // `[]` is a legitimate value, distinct from "leave tags alone" — which the
    // API expresses by omitting the field. Without that distinction a tag
    // editor can only add, never remove.
    expect(normalizeTagNames([])).toEqual([])
  })
})
