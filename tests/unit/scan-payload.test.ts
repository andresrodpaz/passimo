import { describe, expect, it } from 'vitest'
import { classifyScan, normalizePhone, searchTermFor } from '@/lib/scan/payload'

/**
 * Scan classification.
 *
 * Every check-in in the product starts here. A misclassification is not a
 * cosmetic bug: it either serves the wrong customer, spends the wrong gift card,
 * or tells a merchant a valid card is invalid while somebody waits. The whole
 * surface is pinned — every payload shape a real wallet, email or printed coupon
 * can produce.
 */

const UUID = '9f8a7b6c-5d4e-3f2a-1b0c-9d8e7f6a5b4c'

describe('classifyScan — wallet passes', () => {
  it('reads the bare customer id an Apple or Google pass barcode encodes', () => {
    expect(classifyScan(UUID)).toEqual({ kind: 'customer_id', customerId: UUID })
  })

  it('lowercases an uppercased id so lookups match what is stored', () => {
    expect(classifyScan(UUID.toUpperCase())).toEqual({ kind: 'customer_id', customerId: UUID })
  })

  it('extracts the token from the card URL used in emails and passes', () => {
    expect(classifyScan('https://passimo.app/card/card.abc123.def456')).toEqual({
      kind: 'card_token',
      token: 'card.abc123.def456',
    })
  })

  it('prefers the id when a card URL carries one directly', () => {
    expect(classifyScan(`https://passimo.app/card/${UUID}`)).toEqual({
      kind: 'customer_id',
      customerId: UUID,
    })
  })

  it('reads a bare signed card token', () => {
    expect(classifyScan('card.eyJjIjoieCJ9.sig-value')).toEqual({
      kind: 'card_token',
      token: 'card.eyJjIjoieCJ9.sig-value',
    })
  })

  it('reads a signed token written directly after the scheme, dot and all', () => {
    /*
     * `passimo:card.eyJ…` is the form a generator produces when it concatenates
     * the scheme with the token it was handed, and the token already begins
     * `card.`. The separator class used to be `[:/]?` only, so `card` matched as
     * the target kind and the token came out as `.eyJ…` — a leading dot that
     * resolves to nobody. The counter said "no member matches" for a payload
     * following the documented scheme, which is the worst kind of scanner bug:
     * the QR is right, the parser is wrong, and the cashier blames the card.
     */
    expect(classifyScan('passimo:card.eyJjIjoieCJ9.sig-value')).toEqual({
      kind: 'card_token',
      token: 'card.eyJjIjoieCJ9.sig-value',
    })
    expect(classifyScan('psm:card.eyJjIjoieCJ9.sig-value')).toEqual({
      kind: 'card_token',
      token: 'card.eyJjIjoieCJ9.sig-value',
    })
    expect(classifyScan('fidelio:card.eyJjIjoieCJ9.sig-value')).toEqual({
      kind: 'card_token',
      token: 'card.eyJjIjoieCJ9.sig-value',
    })
  })

  it('accepts the custom scheme a pass generator may emit instead of a URL', () => {
    expect(classifyScan(`passimo://customer/${UUID}`)).toEqual({
      kind: 'customer_id',
      customerId: UUID,
    })
    expect(classifyScan(`PSM:C:${UUID}`)).toEqual({ kind: 'customer_id', customerId: UUID })
  })

  it('still reads the pre-rename scheme, because issued cards cannot be recalled', () => {
    /*
     * A card sitting in a customer's Apple Wallet was signed under the old brand
     * and embeds `fidelio:`. Renaming a company does not reissue it. Dropping the
     * old scheme would not throw — `classifyScan` would fall through to `text`,
     * the counter would report "not recognised", and the merchant would conclude
     * the product is broken for their longest-standing customers.
     */
    expect(classifyScan(`fidelio://customer/${UUID}`)).toEqual({
      kind: 'customer_id',
      customerId: UUID,
    })
    expect(classifyScan(`FID:C:${UUID}`)).toEqual({ kind: 'customer_id', customerId: UUID })
    expect(classifyScan('fidelio://card/card.abc.def')).toEqual({
      kind: 'card_token',
      token: 'card.abc.def',
    })
  })
})

describe('classifyScan — resilience to what real scanners produce', () => {
  it('strips the zero-width characters some pass generators embed', () => {
    // Written as escapes on purpose: as literal characters this payload looks
    // identical to a clean one, and an editor stripping them would silently
    // turn the test into a duplicate of the one above.
    const padded = `\u200b${UUID}\ufeff\u00a0`
    expect(classifyScan(padded)).toEqual({ kind: 'customer_id', customerId: UUID })
  })

  it('ignores surrounding whitespace from a keyboard-wedge scanner', () => {
    expect(classifyScan(`  ${UUID}\n`)).toEqual({ kind: 'customer_id', customerId: UUID })
  })

  it('treats an empty read as empty text rather than throwing', () => {
    expect(classifyScan('   ')).toEqual({ kind: 'text', text: '' })
  })

  it('does not mistake a malformed URL for a link', () => {
    const result = classifyScan('http://')
    expect(result.kind).toBe('text')
  })
})

describe('classifyScan — codes', () => {
  it('leaves a bare human code ambiguous for the server to probe', () => {
    expect(classifyScan('7K4M9QDX')).toEqual({
      kind: 'code',
      code: '7K4M9QDX',
      candidates: ['reward', 'gift_card', 'referral'],
    })
  })

  it('strips separators and uppercases so a code can be typed loosely', () => {
    expect(classifyScan('7k4m-9qdx')).toEqual({
      kind: 'code',
      code: '7K4M9QDX',
      candidates: ['reward', 'gift_card', 'referral'],
    })
  })

  it('narrows to a single candidate when the code is prefixed', () => {
    expect(classifyScan('GC-7K4M9QDX')).toEqual({
      kind: 'code',
      code: '7K4M9QDX',
      candidates: ['gift_card'],
    })
    expect(classifyScan('RW:ABCDEFGH')).toEqual({
      kind: 'code',
      code: 'ABCDEFGH',
      candidates: ['reward'],
    })
  })

  it('does not read an ordinary word as a prefixed code', () => {
    // `REF` is a referral prefix, but only with a separator after it.
    const result = classifyScan('REFRESH')
    expect(result.kind).toBe('code')
    expect(result).toMatchObject({ candidates: ['reward', 'gift_card', 'referral'] })
  })

  it('reads a gift card code out of a gift link', () => {
    expect(classifyScan('https://passimo.app/gift/bella-cafe?code=7k4m9qdx')).toEqual({
      kind: 'code',
      code: '7K4M9QDX',
      candidates: ['gift_card'],
    })
  })

  it('narrows a ref parameter to a referral', () => {
    expect(classifyScan('https://shop.example.com/promo?ref=abc123')).toEqual({
      kind: 'code',
      code: 'ABC123',
      candidates: ['referral'],
    })
  })
})

describe('classifyScan — contact details', () => {
  it('reads an email typed at the counter', () => {
    expect(classifyScan('Maria@Example.COM')).toEqual({
      kind: 'email',
      email: 'maria@example.com',
    })
  })

  it('reads an email out of a scanned contact card', () => {
    expect(classifyScan('mailto:maria@example.com?subject=hi')).toEqual({
      kind: 'email',
      email: 'maria@example.com',
    })
  })

  it('reads a phone number out of a tel link', () => {
    expect(classifyScan('tel:+34 600 123 456')).toEqual({
      kind: 'phone',
      phone: '+34600123456',
    })
  })

  it('reads a typed phone number', () => {
    expect(classifyScan('+34 600-123-456')).toEqual({ kind: 'phone', phone: '+34600123456' })
  })

  it('keeps a local number without inventing a country code', () => {
    expect(classifyScan('600123456')).toEqual({ kind: 'phone', phone: '600123456' })
  })
})

describe('classifyScan — join links', () => {
  it('recognises a sign-up link as a prospect, not a member', () => {
    expect(classifyScan('https://passimo.app/join/bella-cafe')).toEqual({
      kind: 'join',
      businessSlug: 'bella-cafe',
      referralCode: null,
    })
  })

  it('carries the referral code through a sign-up link', () => {
    expect(classifyScan('https://passimo.app/join/bella-cafe?ref=7k4m-9qdx')).toEqual({
      kind: 'join',
      businessSlug: 'bella-cafe',
      referralCode: '7K4M9QDX',
    })
  })
})

describe('classifyScan — unrecognised input', () => {
  it('falls back to a name search for free text', () => {
    expect(classifyScan('Maria Gonzalez')).toEqual({ kind: 'text', text: 'Maria Gonzalez' })
  })

  it('pulls an id out of an unfamiliar URL rather than searching for the URL', () => {
    expect(classifyScan(`https://other.example.com/x/y/${UUID}`)).toEqual({
      kind: 'customer_id',
      customerId: UUID,
    })
  })

  it('keeps an unrecognised URL as text rather than guessing', () => {
    expect(classifyScan('https://example.com/some/marketing/page')).toEqual({
      kind: 'text',
      text: 'https://example.com/some/marketing/page',
    })
  })
})

describe('searchTermFor', () => {
  it('gives the fuzzy lookup something to search for', () => {
    expect(searchTermFor({ kind: 'email', email: 'a@b.co' })).toBe('a@b.co')
    expect(searchTermFor({ kind: 'phone', phone: '+34600' })).toBe('+34600')
    expect(searchTermFor({ kind: 'text', text: 'Maria' })).toBe('Maria')
    expect(searchTermFor({ kind: 'code', code: 'ABCDEF', candidates: ['reward'] })).toBe('ABCDEF')
  })

  it('returns null when a search would be pointless', () => {
    // Avoids a round trip that cannot match anything.
    expect(searchTermFor({ kind: 'text', text: 'x' })).toBeNull()
    expect(searchTermFor({ kind: 'customer_id', customerId: UUID })).toBeNull()
    expect(searchTermFor({ kind: 'card_token', token: 'card.a.b' })).toBeNull()
  })
})

describe('normalizePhone', () => {
  it('keeps a leading plus and drops formatting', () => {
    expect(normalizePhone('+34 (600) 123-456')).toBe('+34600123456')
  })

  it('does not add a plus to a local number', () => {
    expect(normalizePhone('600 123 456')).toBe('600123456')
  })
})
