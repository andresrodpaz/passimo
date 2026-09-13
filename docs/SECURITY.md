# Security & privacy

---

## Vulnerabilities found and fixed

### 2026-09-13 — production security audit

Full report in `SECURITY_AUDIT_REPORT.md`; per-control evidence in
`SECURITY_REALITY_MATRIX.md`. Three defects found and fixed, each demonstrated
before being fixed and each now carrying a regression test.

**P1 — every IP-based rate limit bypassable with one header.** `clientIp()` read
`X-Forwarded-For` leftmost, which is the portion a client writes for itself.
Against a running instance, eleven requests to the public join endpoint gave
`404 ×10, 429 ×3`; five more with a rotating forged header were **all admitted**.
The same trick lifts the caps on sign-in and password reset, so it was a
brute-force enabler. Now reads the hop named by `TRUSTED_PROXY_HOPS`, counting
from the right. Tests: `tests/unit/client-ip.test.ts`.

**P1 — cross-tenant gift cards invisible to the release gate.** `db:verify`
maintains its per-relationship listing and its pass/fail verdict as two separate
queries, and gift cards were missing from the verdict. An injected gift card
owned by one workspace but naming another's customer reported **PASS**. Gift
cards are money. Both queries now cover them; the same injected row now fails the
gate.

**P2 — monetary data served with no cache directives.**
`GET /api/v1/public/card/{token}` returns gift-card codes and balances and
carried no `Cache-Control`. Every `defineRoute` response now sets `no-store`.

Two risks were examined and **accepted rather than fixed**, both deliberate: an
installed wallet pass cannot be revoked (it authenticates with a separate
`wallet_auth_token`), and gift-card codes are intentionally shown on the public
card so they can be read at a counter. Both are documented with their threat
models in `docs/CUSTOMER_JOIN_FLOW.md`.

One economic issue is **open and gating**: `messages_per_month` is a single
undifferentiated meter, so a Pro tenant's 50,000 allowance can be spent as SMS.
See SEC-006.

### Earlier

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

**Authorisation.** Enforced at the API layer by `defineRoute`: it resolves the
workspace, verifies the caller's membership, and checks permissions before a
handler runs, so a handler's `business.businessId` is proven rather than
supplied. Tenant-sensitive SQL functions re-check the pair they are given —
`passimo_ensure_account` and `passimo_rotate_card_token` both refuse arguments
that cross a tenant boundary.

> This previously read "…and RLS at the database layer". That is not true and
> has not been since migration `000018`, which removed thirty-odd policies **on
> purpose**: they were written for an architecture where a browser queries
> Postgres directly, and a table owner bypasses its own policies unless they are
> forced, which none were. Isolation is real and it is in the application layer.
> `db:verify` checks it independently (`cross_tenant_relationship_violations`).

**Rate limiting.** Postgres-backed (`passimo_rate_limit`), so the counter is
shared across instances rather than per-process — correct for Railway. Keyed on
the client address derived by `clientIp()`, which reads the hop named by
`TRUSTED_PROXY_HOPS` counting from the **right** of `X-Forwarded-For`, because
that header grows left to right and the leftmost entry is written by the client.
It previously read the leftmost entry, which made every IP-keyed limit — sign-in,
password reset, public enrolment — bypassable with a single forged header;
demonstrated and fixed in the 2026-09-13 audit. **Set `TRUSTED_PROXY_HOPS` to the
real proxy depth in every deployment, and to `0` where nothing fronts the app** —
the fix is configuration-dependent and a wrong value restores the bypass.

Two limitations, stated rather than implied: the limiter **fails open** if the
database errors (a fault removes brute-force protection on sign-in at the moment
the system is degraded), and limits are per-IP rather than per-account on the
authentication endpoints.

**Caching.** Every `defineRoute` response carries `Cache-Control: no-store`, set
at the choke point so a new endpoint inherits it. This matters most for
`GET /api/v1/public/card/{token}`, which serves gift-card balances and codes to
an anonymous bearer and previously carried no cache directives at all.

**Customer card links.** `/card/{token}` is a bearer capability URL —
HMAC-SHA256, purpose-scoped, 365-day TTL, claims `{c, v, exp}` and no PII. The
card behind it carries gift-card balances and codes, so possession is access.
`customers.card_token_version` makes a link revocable: merchants rotate it from
the customer page (`customers:write`), which invalidates every link issued so
far without touching the membership. **An already-installed wallet pass keeps
working** — it authenticates with a separate `wallet_auth_token`. Full threat
model and payload inventory in `docs/CUSTOMER_JOIN_FLOW.md`.

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
