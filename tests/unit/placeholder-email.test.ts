import { describe, expect, it } from 'vitest'
import {
  PLACEHOLDER_EMAIL_DOMAIN,
  isPlaceholderEmail,
  placeholderEmailForPhone,
  realEmailOrNull,
} from '@/lib/customers/placeholder-email'

/**
 * The synthetic-address contract.
 *
 * `customers.email` cannot be null, so a phone-only customer gets a minted
 * undeliverable address. Every screen that shows an email and every channel that
 * sends to one has to tell the two apart. The failure mode is not a crash: it is
 * `no-email+34600123456@passimo.invalid` printed on a customer profile, or a
 * campaign counting a send against the merchant's quota for an address that
 * cannot receive it.
 */

describe('isPlaceholderEmail', () => {
  it('recognises an address it minted', () => {
    expect(isPlaceholderEmail(placeholderEmailForPhone('+34 600 123 456'))).toBe(true)
  })

  it('recognises the merge and erasure sentinels', () => {
    // Written by `passimo_merge_customers` and `passimo_anonymize_customer`.
    expect(isPlaceholderEmail('merged+abc@passimo.invalid')).toBe(true)
    expect(isPlaceholderEmail('erased+abc@passimo.invalid')).toBe(true)
  })

  it('still recognises the pre-rename domain', () => {
    /*
     * Migration 17 rewrites the stored rows, but the value also travels: a CSV a
     * merchant exported last week, a webhook payload already delivered, a wallet
     * pass issued before the migration ran. Failing to recognise it would show a
     * merchant a fake address and let a campaign try to mail it.
     */
    expect(isPlaceholderEmail('no-email+34600123456@fidelio.invalid')).toBe(true)
    expect(isPlaceholderEmail('merged+abc@fidelio.invalid')).toBe(true)
  })

  it('is case-insensitive, because citext is', () => {
    // The column is `citext`, so Postgres considers these the same address. A
    // case-sensitive check here would disagree with the database.
    expect(isPlaceholderEmail('No-Email+34600@PASSIMO.INVALID')).toBe(true)
  })

  it('leaves a real address alone', () => {
    expect(isPlaceholderEmail('ana@example.com')).toBe(false)
    // The domain must match at the end, not merely appear.
    expect(isPlaceholderEmail('passimo.invalid@example.com')).toBe(false)
  })

  it('treats absent as not-a-placeholder rather than throwing', () => {
    expect(isPlaceholderEmail(null)).toBe(false)
    expect(isPlaceholderEmail(undefined)).toBe(false)
    expect(isPlaceholderEmail('')).toBe(false)
  })
})

describe('realEmailOrNull', () => {
  it('passes a reachable address through', () => {
    expect(realEmailOrNull('ana@example.com')).toBe('ana@example.com')
  })

  it('returns null for a placeholder, so callers fall back to the phone', () => {
    expect(realEmailOrNull('no-email+34600@passimo.invalid')).toBeNull()
    expect(realEmailOrNull('no-email+34600@fidelio.invalid')).toBeNull()
  })

  it('returns null for nothing', () => {
    expect(realEmailOrNull(null)).toBeNull()
    expect(realEmailOrNull(undefined)).toBeNull()
  })
})

describe('placeholderEmailForPhone', () => {
  it('mints under the reserved .invalid TLD, which can never resolve', () => {
    // RFC 2606. A leak into a mail queue bounces at the resolver rather than
    // reaching a real inbox that happens to belong to somebody else.
    expect(placeholderEmailForPhone('+34600123456')).toContain(`@${PLACEHOLDER_EMAIL_DOMAIN}`)
    expect(PLACEHOLDER_EMAIL_DOMAIN.endsWith('.invalid')).toBe(true)
  })

  it('derives the address from the digits, so the same phone collides', () => {
    /*
     * This is what makes re-enrolling the same person a merge rather than a
     * second card: the unique index on (business_id, email) rejects the
     * duplicate. Formatting differences must therefore not produce two
     * different addresses.
     */
    expect(placeholderEmailForPhone('+34 600 123 456')).toBe(
      placeholderEmailForPhone('(34) 600-123-456')
    )
    expect(placeholderEmailForPhone('+34600123456')).toBe(
      'no-email+34600123456@passimo.invalid'
    )
  })

  it('produces different addresses for different numbers', () => {
    expect(placeholderEmailForPhone('+34600123456')).not.toBe(
      placeholderEmailForPhone('+34600123457')
    )
  })
})
