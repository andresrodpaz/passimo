/**
 * The synthetic address given to a customer who has no email.
 *
 * `customers.email` is `not null` and unique per business — it is the natural
 * key the enrolment function de-duplicates on — but a shop that takes a phone
 * number at the till has no address to put there. So the enrolment paths mint a
 * deliberately undeliverable one, and every read path that shows or sends to an
 * address has to recognise it and fall back.
 *
 * The domain is `.invalid`, which RFC 2606 reserves precisely so that it can
 * never resolve. A mistake that leaks one of these into a mail queue bounces at
 * the resolver instead of reaching a real inbox belonging to somebody else.
 *
 * Centralised because the test used to be an inline `endsWith` in eight places.
 * That is one place per screen for the rename to be missed, and a missed one does
 * not throw — it quietly prints `no-email+34600123456@passimo.invalid` on a
 * customer profile, or worse, treats it as contactable and counts a marketing
 * send against the merchant's monthly quota.
 *
 * Isomorphic: the dashboard renders these decisions on the client.
 */

/** The domain new placeholder addresses are minted under. */
export const PLACEHOLDER_EMAIL_DOMAIN = 'passimo.invalid'

/**
 * Domains that mean "this is not a real address".
 *
 * `fidelio.invalid` predates the rename. Migration 17 rewrites the stored rows,
 * but the value also travels: it is in CSV exports a merchant has already
 * downloaded, in webhook payloads already delivered, and in wallet passes issued
 * before the migration ran. Recognising the old domain forever costs one array
 * entry; failing to recognise it shows a merchant a fake address and lets a
 * campaign try to mail it.
 */
const PLACEHOLDER_EMAIL_DOMAINS: readonly string[] = [
  PLACEHOLDER_EMAIL_DOMAIN,
  'fidelio.invalid',
]

/** True when this address is a placeholder rather than something reachable. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const value = email.toLowerCase()
  return PLACEHOLDER_EMAIL_DOMAINS.some((domain) => value.endsWith(`@${domain}`))
}

/**
 * The address to show, or null when there is nothing worth showing.
 *
 * Read paths should prefer this over testing the domain themselves, so that
 * "is there an email here" has exactly one answer across the product.
 */
export function realEmailOrNull(email: string | null | undefined): string | null {
  if (!email || isPlaceholderEmail(email)) return null
  return email
}

/**
 * Mints the placeholder for a phone-only customer.
 *
 * Derived from the digits of the phone number rather than a random value, so
 * enrolling the same person twice collides on the unique index and merges into
 * one customer instead of creating a second card for the same phone.
 */
export function placeholderEmailForPhone(phone: string): string {
  return `no-email+${phone.replace(/\D/g, '')}@${PLACEHOLDER_EMAIL_DOMAIN}`
}
