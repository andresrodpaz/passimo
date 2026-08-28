/**
 * Scan payload classification.
 *
 * A cashier holds up a phone and something arrives: a wallet pass barcode, a
 * link from an email, a code read off a paper coupon, a typed phone number.
 * They should never have to tell us which. This module turns any of those into
 * a typed intent, and it is deliberately free of server imports so the client
 * can pre-classify (to pick the right optimistic UI) and so it is cheap to test
 * exhaustively.
 *
 * Ambiguity is represented, not guessed. A bare `7K4M9QDX` could be a gift
 * card, a reward claim code or a referral code; the resolver probes all three
 * concurrently rather than forcing the merchant to choose a mode first.
 */

export type ScanPayload =
  /** Wallet barcodes encode the bare customer id. */
  | { kind: 'customer_id'; customerId: string }
  /** Signed capability token from an email link or wallet web service. */
  | { kind: 'card_token'; token: string }
  /** Human-readable code whose type we cannot know from its shape alone. */
  | { kind: 'code'; code: string; candidates: CodeKind[] }
  | { kind: 'email'; email: string }
  | { kind: 'phone'; phone: string }
  /** A join link — the person is not a member yet. */
  | { kind: 'join'; businessSlug: string; referralCode: string | null }
  /** Free text: fall through to fuzzy customer search. */
  | { kind: 'text'; text: string }

/**
 * Coalition offers are intentionally absent: they carry no printed code and are
 * claimed from an identified customer's context, not scanned on their own.
 */
export type CodeKind = 'reward' | 'gift_card' | 'referral'

const ALL_CODE_KINDS: CodeKind[] = ['reward', 'gift_card', 'referral']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
/** The alphabet `randomCode` uses — no I/O/0/1, so codes survive being read aloud. */
const HUMAN_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789-]{6,24}$/

/**
 * Explicit prefixes let us skip probing entirely. Printed material and our own
 * deep links use them; scanned wallet passes generally do not.
 */
const CODE_PREFIXES: Array<{ prefix: string; kind: CodeKind }> = [
  { prefix: 'RW', kind: 'reward' },
  { prefix: 'REWARD', kind: 'reward' },
  { prefix: 'GC', kind: 'gift_card' },
  { prefix: 'GIFT', kind: 'gift_card' },
  { prefix: 'REF', kind: 'referral' },
]

/**
 * Zero-width and bidi characters ride along in QR payloads produced by some
 * pass generators and break exact-match lookups invisibly.
 */
function clean(raw: string): string {
  return raw
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff\u00a0]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function classifyScan(raw: string): ScanPayload {
  const value = clean(raw)
  if (!value) return { kind: 'text', text: '' }

  // 1. Our own URLs and any URL carrying a recognisable parameter.
  const fromUrl = fromUrlPayload(value)
  if (fromUrl) return fromUrl

  /*
   * 2. Custom schemes, for pass generators that cannot embed https links.
   *
   * `passimo:` / `psm:` are the current schemes. `fidelio:` / `fid:` are kept
   * deliberately: they are printed on physical material and embedded in wallet
   * passes already issued under the old brand, and a card in somebody's phone
   * cannot be re-issued by renaming a company. Accepting both costs one
   * alternation; dropping the old one would silently stop recognising customers
   * who enrolled before the rename.
   */
  const scheme = /^(?:passimo|psm|fidelio|fid):(?:\/\/)?(customer|card|c)\/?[:/]?(.+)$/i.exec(value)
  if (scheme) {
    const target = clean(scheme[2]!)
    if (UUID_RE.test(target)) return { kind: 'customer_id', customerId: target.toLowerCase() }
    return { kind: 'card_token', token: target }
  }

  // 3. Signed capability tokens are `<purpose>.<body>.<signature>`.
  if (/^card\.[\w-]+\.[\w-]+$/.test(value)) return { kind: 'card_token', token: value }

  // 4. Wallet barcodes: the bare customer id.
  if (UUID_RE.test(value)) return { kind: 'customer_id', customerId: value.toLowerCase() }

  // 5. Contact scans (QR contact cards, `mailto:`, `tel:`).
  const mailto = /^mailto:([^?]+)/i.exec(value)
  if (mailto && EMAIL_RE.test(clean(mailto[1]!))) {
    return { kind: 'email', email: clean(mailto[1]!).toLowerCase() }
  }
  const tel = /^(?:tel|sms):(\+?[\d\s().-]{6,20})$/i.exec(value)
  if (tel) return { kind: 'phone', phone: normalizePhone(tel[1]!) }

  if (EMAIL_RE.test(value)) return { kind: 'email', email: value.toLowerCase() }

  // 6. Prefixed codes carry their own type.
  const prefixed = matchPrefixedCode(value)
  if (prefixed) return prefixed

  // 7. A bare human code: ambiguous by design, resolved by probing.
  const compact = value.replace(/[\s-]/g, '').toUpperCase()
  if (HUMAN_CODE_RE.test(value.toUpperCase()) && compact.length >= 6 && compact.length <= 24) {
    return { kind: 'code', code: compact, candidates: ALL_CODE_KINDS }
  }

  // 8. Phone numbers, once we know it is not a code.
  const digits = value.replace(/[\s().-]/g, '')
  if (/^\+?\d{7,15}$/.test(digits)) return { kind: 'phone', phone: normalizePhone(digits) }

  return { kind: 'text', text: value }
}

function matchPrefixedCode(value: string): ScanPayload | null {
  const upper = value.toUpperCase()
  for (const { prefix, kind } of CODE_PREFIXES) {
    // Require a separator so `REFRESH` is not read as a `REF` code.
    const match = new RegExp(`^${prefix}[-_:]([A-Z0-9-]{4,24})$`).exec(upper)
    if (match) {
      return { kind: 'code', code: match[1]!.replace(/-/g, ''), candidates: [kind] }
    }
  }
  return null
}

function fromUrlPayload(value: string): ScanPayload | null {
  if (!/^https?:\/\//i.test(value)) return null

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }

  const segments = url.pathname.split('/').filter(Boolean)
  const params = url.searchParams

  // /card/<signed token> — the link in every email and wallet pass.
  const cardIndex = segments.indexOf('card')
  if (cardIndex !== -1 && segments[cardIndex + 1]) {
    const token = decodeURIComponent(segments[cardIndex + 1]!)
    if (UUID_RE.test(token)) return { kind: 'customer_id', customerId: token.toLowerCase() }
    return { kind: 'card_token', token }
  }

  // /join/<business slug>?ref=<referral code> — a prospect, not a member.
  const joinIndex = segments.indexOf('join')
  if (joinIndex !== -1 && segments[joinIndex + 1]) {
    const ref = params.get('ref') ?? params.get('referral')
    return {
      kind: 'join',
      businessSlug: decodeURIComponent(segments[joinIndex + 1]!),
      referralCode: ref ? ref.replace(/[\s-]/g, '').toUpperCase() : null,
    }
  }

  // /gift/<slug>?code=<gift card code>
  if (segments.includes('gift')) {
    const code = params.get('code')
    if (code) {
      return {
        kind: 'code',
        code: code.replace(/[\s-]/g, '').toUpperCase(),
        candidates: ['gift_card'],
      }
    }
  }

  // Generic parameters, so a merchant's own printed QR can carry an identifier.
  const direct = params.get('c') ?? params.get('customer') ?? params.get('customerId')
  if (direct && UUID_RE.test(direct)) {
    return { kind: 'customer_id', customerId: direct.toLowerCase() }
  }
  const code = params.get('code')
  if (code) {
    return {
      kind: 'code',
      code: code.replace(/[\s-]/g, '').toUpperCase(),
      candidates: ALL_CODE_KINDS,
    }
  }
  const ref = params.get('ref') ?? params.get('referral')
  if (ref) {
    return {
      kind: 'code',
      code: ref.replace(/[\s-]/g, '').toUpperCase(),
      candidates: ['referral'],
    }
  }
  const email = params.get('email')
  if (email && EMAIL_RE.test(email)) return { kind: 'email', email: email.toLowerCase() }

  // A URL we do not recognise: the last path segment is the best guess, and is
  // still better than sending the whole URL into a name search.
  const last = segments.at(-1)
  if (last && UUID_RE.test(last)) return { kind: 'customer_id', customerId: last.toLowerCase() }

  return { kind: 'text', text: value }
}

/** Keeps a leading `+` and digits only, so lookups match what we store. */
export function normalizePhone(value: string): string {
  const trimmed = value.trim()
  const digits = trimmed.replace(/\D/g, '')
  return trimmed.startsWith('+') ? `+${digits}` : digits
}

/**
 * The search term to hand to the fuzzy customer lookup for a payload that did
 * not resolve to an exact entity. Returns null when there is nothing sensible
 * to search for, so callers can avoid a pointless round trip.
 */
export function searchTermFor(payload: ScanPayload): string | null {
  switch (payload.kind) {
    case 'email':
      return payload.email
    case 'phone':
      return payload.phone
    case 'text':
      return payload.text.length >= 2 ? payload.text : null
    case 'code':
      return payload.code
    default:
      return null
  }
}
