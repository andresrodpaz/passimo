# Security & privacy

---

## Vulnerabilities found and fixed

The audit of the previous implementation turned up the following. All are fixed.

### Critical

**Unlimited free rewards via the referral endpoint.**
`POST /api/referrals/validate` was unauthenticated and credited a stamp to the
referrer on every call. Anyone with a referral code could loop it and mint
unlimited rewards.
*Fixed:* the endpoint is gone. Referrals are recorded as `pending` at signup and
only pay out via `passimo_qualify_referrals` after the referred customer
actually transacts. Self-referral is rejected, and payout is idempotent on the
referral id.

**The entire merchant dashboard was public.**
No authentication existed anywhere in the frontend — `/dashboard` and all its
sub-pages rendered for anyone.
*Fixed:* `middleware.ts` validates the session with `getUser()` (which
revalidates the JWT, unlike `getSession()`) and redirects to `/login`,
preserving the intended destination. Covered by an E2E regression test.

**Lost updates on every balance.**
Stamp counts were read into JavaScript, incremented, and written back. Two
concurrent taps lost one award; a retried request awarded twice.
*Fixed:* all balance mutation happens in `passimo_credit_account` /
`passimo_debit_account` — one transaction, a row lock, and an idempotency key.

### High

**Customer PII exposed by guessable URL.**
`/api/wallet/apple/{customerId}` took a raw UUID and returned a pass containing
the customer's name; `/api/wallet/google/{customerId}` the same.
*Fixed:* both require a purpose-scoped, expiring HMAC capability token.

**No rate limiting anywhere.**
`/api/customers/join` could be looped to enumerate customers and to force
unbounded outbound email at the operator's expense.
*Fixed:* Postgres-backed distributed rate limiting with named policies per route
class, plus an in-process short-circuit for hot attack loops.

**Campaign sends ran inline.**
One HTTP request looped `await resend.send()` over every customer: guaranteed
timeout past a few hundred recipients, partial sends, and duplicate emails on
retry.
*Fixed:* enqueue → batch → per-recipient idempotency key.

**No unsubscribe mechanism.** Marketing email with no opt-out — a GDPR art. 21
and CAN-SPAM violation, and a fast route to a blocklisted sending domain.
*Fixed:* signed unsubscribe tokens, a granular landing page, `List-Unsubscribe`
and `List-Unsubscribe-Post` headers, and a suppression list enforced in the
dispatcher.

**Guessable stored-value codes.** Gift card and referral codes came from
`substring(md5(random()::text), 1, 12)` — not uniformly distributed and
brute-forceable.
*Fixed:* `passimo_random_code` uses `gen_random_bytes` (CSPRNG) over an
unambiguous alphabet.

**Secrets committed.** `.gitignore` only excluded `.env*.local`, so a populated
`.env` was tracked.
*Fixed:* `.gitignore` excludes `.env` and `.env.*` except `.env.example`.
**Any credential that was ever committed must be rotated.**

### Medium

- `FOR ALL USING (…)` policies without `WITH CHECK` allowed cross-tenant inserts
  on some paths → every policy now states both.
- Case-sensitive emails let `Ana@x.com` and `ana@x.com` hold separate balances →
  `citext`.
- NPS stored 1–5 but was reported as NPS (a −100…+100 scale) → proper 0–10
  surveys, with the original `scale_max` preserved on migrated rows.
- No audit trail → `audit_log` on every privileged mutation.
- No security headers → CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy` on every response.
- Login errors distinguished "no such user" from "wrong password" → uniform
  message; password reset always reports success.
- Unbounded list endpoints → mandatory pagination with a hard ceiling.

---

## Controls

**Injection.** All data access goes through PostgREST parameter binding. The
only dynamic SQL is `passimo_segment_*` and `passimo_customers_with_date_today`,
which interpolate exclusively from allow-lists and take all values as bound JSON
parameters. `passimo_increment_campaign_counter` validates its column name
against a fixed list. Covered by injection-payload tests.

**XSS.** React escapes by default. The one place raw HTML is produced is the
email renderer, which escapes every interpolated value. CSP sets
`object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`.

**CSRF.** State-changing endpoints accept JSON only and are authenticated by a
bearer token or a `SameSite=Lax` session cookie; simple cross-origin form posts
cannot reach them.

**Authorisation.** Enforced twice: `defineRoute` permissions at the API layer,
RLS at the database layer.

**Secrets.** Never in client bundles (`server-only` guards). API keys are stored
as SHA-256 hashes; the plaintext is shown once. Integration credentials live in
a table with no permissive RLS policy. The logger redacts any key matching
`password|secret|token|api_key|authorization|cookie|signature|p8|pem`.

**Webhooks.** Inbound signatures are verified per provider against the raw body
(Stripe with timestamp tolerance, Shopify/WooCommerce HMAC-base64, Square
including the notification URL). Outbound payloads are HMAC-signed with a
per-endpoint secret plus a timestamp; endpoints that fail 10 times in a row are
auto-disabled.

**Passwords.** Minimum 10 characters, length-weighted strength meter, no
composition rules — per NIST 800-63B, which found they push people toward
weaker, more predictable passwords.

Hashing is scrypt from Node's standard library (N=2^15, r=8, p=1), with the
parameters stored alongside each hash so the cost factor can be raised without
invalidating existing passwords; `lib/auth/password.ts` upgrades a hash in place
on the next successful sign-in. Sign-in takes the same time whether or not the
address exists, and five failures lock an account for fifteen minutes on top of
the per-IP rate limit. Reset links are single-use, expire in an hour, are stored
only as a SHA-256, and consuming one revokes every other session for the account.
See `docs/AUTHENTICATION.md`.

---

## GDPR

| Requirement | Implementation |
| --- | --- |
| Art. 6/7 — lawful basis, consent | Per-channel booleans plus `consent_updated_at`, `consent_source`, `consent_ip`; explicit terms acceptance on the join form |
| Art. 15 — access | `data_requests` (email-verified) → background export to a 7-day signed URL |
| Art. 17 — erasure | `passimo_anonymize_customer` destroys personal data, keeps aggregate financial history as permitted by 17(3) |
| Art. 20 — portability | CSV and JSON export, merchant-initiated, audited |
| Art. 21 — objection | One-click unsubscribe, granular per channel |
| Art. 30 — records of processing | `audit_log` |
| Art. 32 — security of processing | RLS, encryption at rest and in transit, least privilege, audit trail |
| Art. 25 — data protection by design | Imported contacts default to **no** marketing consent; POS auto-enrol is opt-in per integration and never assumes consent |

Erasure requests are email-verified before execution. Without verification, an
open endpoint that erases a customer by email address is a denial-of-service
weapon aimed at the merchant.

---

## Reporting

Email `security@passimo.app`. Please do not open a public issue.
