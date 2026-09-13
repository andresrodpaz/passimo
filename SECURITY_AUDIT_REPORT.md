# Passimo — production security audit

**Date:** 2026-09-13
**Method:** repository and schema review, plus adversarial requests against a running instance and a live PostgreSQL database.
**Standard applied:** a control is only reported as working when something was executed that would have failed without it. Reading the code is not evidence.

---

## 1. Executive summary

Passimo's security architecture is better than most products at this stage, and the reason is structural rather than diligent: `defineRoute` is a single choke point that resolves the tenant, verifies membership and checks permissions before any handler runs, so isolation is a property of the framework rather than something 78 routes each have to remember. That held under adversarial testing — a second merchant's session naming the first merchant's `businessId` was refused with `403` on every endpoint tried.

Three real defects were found and fixed during the audit. Each was contained, each now has a regression test, and each was verified as a defect *before* being fixed:

1. **Every IP-based rate limit was bypassable with one header.** `X-Forwarded-For` was read leftmost — the value a client writes for itself. Eleven requests gave `404×10, 429×3`; five more with a rotating forged header were **all admitted**. This is a brute-force enabler on sign-in and password reset, not merely an abuse one.
2. **The cross-tenant release gate did not cover gift cards.** An injected gift card belonging to one workspace but naming another's customer reported **PASS**. Gift cards are money.
3. **The public card served gift-card codes and balances with no cache directives at all.**

The two most significant *unfixed* items are deliberate, and both are economic rather than technical: an installed wallet pass cannot be revoked, and `messages_per_month` is a single undifferentiated meter that would let a Pro tenant send 50,000 SMS.

**Nothing found suggests a customer or merchant can read another tenant's data.** The blockers are about money and abuse, not confidentiality.

---

## 2. Scope

In scope: 78 API routes, middleware, authentication and session handling, RBAC, tenant resolution, the PostgreSQL schema and 27 migrations, public customer surfaces, card tokens, wallet integration, gift cards, Stripe webhooks, AI, uploads, messaging, rate limiting, audit logging, security headers, caching, secrets and public security claims.

Out of scope, and therefore **UNVERIFIED**: any behaviour requiring credentials this environment does not hold — live Anthropic calls, live Stripe events, Apple/Google pass signing, Twilio/WhatsApp sends, and S3 storage. Local fallback behaviour is not production readiness and is not reported as such.

---

## 3. Threat model

| # | Attacker | Credentials held | Assets in reach | Primary path | Finding |
|---|---|---|---|---|---|
| A | Unauthenticated internet | none | public join/card/QR, auth endpoints | enumeration, brute force, abuse | **SEC-001** (rate-limit bypass) |
| B | Authenticated customer | a card URL | own card, gift-card codes, balance | bearer replay | **SEC-005** (accepted) |
| C | Merchant staff | session, `customers:write` | own tenant | privilege escalation | none found |
| D | Merchant admin | session, most permissions | own tenant, billing | tenant escape | none found |
| E | **Merchant A → Merchant B** | valid session, forged ids | another tenant's everything | IDOR / forged `businessId` | none found — `403`/`404` on 12 probes |
| F | Holder of a leaked card URL | the URL | gift-card code + balance | spend the card | **SEC-005**; rotation is the response |
| G | Holder of an installed pass | the device | card updates indefinitely | no revocation exists | **SEC-004** |
| H | Malicious merchant input | own tenant data | AI prompts, emails, exports | injection | mitigated (`<untrusted_data>`, escaping) |
| I | Malicious customer input | join form, survey | AI prompts, staff screens | stored XSS / injection | mitigated |
| J | Prompt-injection via stored data | CSV import, notes, comments | AI output | instruction override | mitigated, prior audit |
| K | Compromised API credential | one tenant's key | that tenant only | lateral movement | scoped to one business |
| L | Stripe/webhook attacker | none | subscription state | forged/replayed event | signature + unique-index replay guard (**unverified live**) |
| M | Operator with DB access | full | everything | insider | out of scope; ledger is immutable by trigger |

---

## 4. Architecture and security boundaries

```
Internet
   │
   ├─ middleware ─ security headers on every response; session-cookie presence check
   │
   ├─ PUBLIC (12 routes, auth:'none')
   │    join · card · business · qr · proximity · survey · unsubscribe · gift-cards
   │    auth: login/signup/reset/verify
   │    └─ guarded by: rate limit ─ input schema ─ slug/token resolution
   │
   ├─ defineRoute (66 routes)  ← the boundary that matters
   │    request-id → rate limit → auth → validation → tenant resolution
   │    → membership check → permission check → handler
   │
   └─ HAND-ROLLED (8 routes)   ← audited individually
        admin×2 (platform_admins row required) · stripe webhook (signature+replay)
        integrations webhook (HMAC) · qr (origin allowlist) · wallet×3 (token/pass auth)
```

The tenant is **never** taken from the request body. `businessIdFrom` names where the id is read from, and `defineRoute` proves membership before the handler sees it.

---

## 5. Findings

### SEC-001 — Every IP-based rate limit bypassable via `X-Forwarded-For` · **P1** · FIXED

**Component:** `lib/rate-limit.ts` → `clientIp()`
**Scenario:** an unauthenticated attacker rotates a forged header to get unlimited attempts against any IP-keyed limit — sign-in (8 per 5 min), password reset, public enrolment (10/min), proximity.
**Preconditions:** none. One header.
**Impact:** credential brute force; unbounded customer enrolment; unbounded public probing.

**Evidence (before):**
```
POST /api/v1/public/join ×13                  → 404 ×10, 429 ×3
POST /api/v1/public/join ×5  X-Forwarded-For: 10.1.2.<n>  → 404 ×5   (all admitted)
```

**Current control and why it was insufficient:** the limit itself worked — it is Postgres-backed and shared across instances. The *key* was wrong: `split(',')[0]` is the leftmost entry, which is exactly the portion a client writes.

**Remediation:** read the hop the deployment actually trusts. `X-Forwarded-For` grows left to right (each proxy appends what it saw), so with one trusted proxy the rightmost entry is the proxy's own observation. `TRUSTED_PROXY_HOPS` names the depth; `0` ignores the header entirely for a directly-exposed app.

**Evidence (after), production shape:**
```
XFF: 10.9.9.<varies>, 203.0.113.9  ×12   → 404 ×10, 429 ×2   (forged prefix no longer creates keys)
XFF: 10.9.9.1, 198.51.100.42             → 404                (a real different client still allowed)
```

**Regression test:** `tests/unit/client-ip.test.ts` (7).
**Residual:** the fix is only as good as the configuration. `TRUSTED_PROXY_HOPS=1` on a deployment with no proxy in front of it leaves the bypass fully intact — verified, and pinned by a test that documents it as a limitation rather than a guarantee. **Production blocker: NO** (fixed), but **setting this correctly on Railway is a release condition.**

---

### SEC-002 — Cross-tenant gift cards invisible to the release gate · **P1** · FIXED

**Component:** `scripts/db/014_tenant_isolation.sql`
**Scenario:** a gift card owned by workspace A names workspace B's customer as recipient. Nothing in the schema prevents it — the foreign key proves the customer exists, not whose it is.
**Impact:** a monetary cross-tenant link ships undetected; `db:verify` reports PASS and the release proceeds.

**Evidence:** injected such a row against the live database → `cross_tenant_relationship_violations=0`, verdict **PASS**. The per-relationship listing and the verdict are two separately maintained queries, and gift cards were absent from the verdict.

**Remediation:** added `gift_cards → recipient_customer` and `→ purchaser_customer` to both the listing and the verdict sum.

**Evidence (after):** same injected row → **FAIL, violations=1**. Row removed → PASS, `234 pass / 0 fail`.

Three other additions I first made were **already present** further down the file and were reverted — worth recording, because a duplicated check reads as coverage while adding none.

**Production blocker: NO** (fixed).

---

### SEC-003 — Public card served monetary data with no cache directives · **P2** · FIXED

**Component:** `lib/api/handler.ts`
**Evidence (before):** `GET /api/v1/public/card/{token}` returned gift-card `code` and `remaining_value` with **no `Cache-Control` header**, leaving storage to whatever an intermediary chose. A per-token URL makes collision unlikely, not impossible — not the standard for a monetary response.
**Remediation:** `Cache-Control: no-store` on every `defineRoute` response, set at the choke point so new endpoints are covered by construction; a route that sets its own directive keeps it.
**Evidence (after):** public card `no-store`; dashboard `no-store`; `/api/v1/public/qr` still `public, max-age=86400, immutable`.
**Production blocker: NO** (fixed).

---

### SEC-004 — An installed wallet pass cannot be revoked · **P1** · ACCEPTED RISK

**Component:** `lib/wallet/*`, `customers.wallet_auth_token`
**Scenario:** a customer's phone is lost or a pass is cloned. The merchant rotates the card link — and the installed pass keeps working.
**Evidence (live, after rotating):**
```
ApplePass <wallet_auth_token>  → 302   (still authorised; re-issues the pass)
ApplePass <wrong>              → 401
```
Rotation revokes the browser link and the wallet *download* URL. It does not touch `wallet_auth_token`, which has no rotation path, and `buildPassContent` mints a fresh card token on every pass update — so the pass repairs its own embedded link.

**Why this is not silently mis-stated:** the merchant-facing confirmation dialog says an installed pass keeps working, and the documentation says so twice. The danger here is a reassuring UI, not the gap itself.

**Remediation (not implemented):** rotate `wallet_auth_token` alongside the card token, behind a distinct, more explicit merchant action — it forces the customer to re-add the pass, which is a different promise from "replace the link".
**Production blocker: NO** for a pilot with a known merchant list. **YES** before positioning wallet passes as a security boundary.

---

### SEC-005 — Gift-card codes and balances on a bearer URL · **P1** · ACCEPTED RISK (deliberate)

**Evidence (live):** a bearer of the card URL receives
```json
"gift_cards": [{"code": "AUDITGC…", "remaining_value": 50, "currency": "EUR"}]
```
plus the `code` of every claimed reward redemption.

**This is a considered product decision, not an accident.** Verified before concluding: `app/card/[token]/page.tsx` renders both in styled monospace blocks built for reading at a counter, and the route carries a comment explaining that a gift card the customer cannot show is one that expires unspent.

**Threat model:** possession of the URL is access. The URL lives 365 days by design, is pasted into wallet passes and emails, and survives a screenshot. Maximum impact is the balance of that customer's active gift cards plus their claimable rewards — bounded per customer, no lateral movement.
**Mitigation:** rotation (SEC-004 aside) is the revocation mechanism, now merchant-operable. Queries were hardened to filter `business_id` during this audit.
**Production blocker: NO** — accepted, documented, bounded. It becomes one the moment stored value can be *topped up* rather than merely displayed.

---

### SEC-006 — `messages_per_month` is a single undifferentiated meter · **P0** · OPEN

**Component:** `lib/billing/plans.ts`
**Evidence:** `messages_per_month` = Free 0 / Starter 2,000 / Growth 15,000 / **Pro 50,000**. There is no `sms` or `whatsapp` key anywhere in the plan catalogue — the word does not appear. Both channels are implemented (`lib/messaging/dispatch.ts` handles `email | sms | whatsapp | push`) and provider-gated on credentials.
**Scenario:** a Pro tenant sends their 50,000 allowance as SMS instead of email.
**Impact:** email is fractions of a cent; SMS is roughly €0.04–0.08 per message depending on destination. 50,000 SMS is therefore on the order of **€2,000–4,000 of provider cost against one Pro subscription**, per month, entirely within the rules. WhatsApp is priced per conversation with a similar shape.
**Why the current control is insufficient:** the meter counts sends, not cost. It cannot distinguish the cheap channel from the one that bankrupts the tier.
**Remediation:** meter per channel (`sms_per_month`, `whatsapp_per_month`) before either provider is credentialled in production, or gate both channels off at the plan level until they are.
**Production blocker: YES** — but only for SMS/WhatsApp. Email-only operation is unaffected.

---

### SEC-007 — Rate limiter fails open · **P2** · OPEN

**Component:** `lib/rate-limit.ts`
**Evidence:** the `catch` returns `allowed: true` for every bucket when the RPC throws.
**Impact:** a database fault removes brute-force protection from sign-in and password reset at the same moment the system is degraded. Logged at `error`, so it is visible.
**Counter-argument, stated fairly:** if Postgres is unreachable, nearly every route fails anyway, so the window where this matters is narrow — a limiter-specific failure (lock contention, connection exhaustion) while reads still succeed.
**Recommendation:** fail closed on the authentication buckets (`auth`, `authSignIn`) and keep fail-open elsewhere. Availability is the right trade for a dashboard list; it is not the right trade for a password field.
**Production blocker: NO.**

---

### SEC-008 — CSP `frame-ancestors` contradicts the embedding intent · **P3** · INFO

**Evidence:** middleware deletes `X-Frame-Options` for `/card` and `/join` with the comment *"embeddable by design (email clients, wallet apps)"*, but the CSP sets `frame-ancestors 'none'` unconditionally — and CSP takes precedence. Live headers on `/join` confirm `frame-ancestors 'none'` present with no `X-Frame-Options`.
**Impact:** none today; it fails **closed**. The risk is someone diagnosing "the card won't embed" and relaxing the CSP globally instead of narrowing it to those two paths.
**Recommendation:** make them agree — either drop the `X-Frame-Options` deletion as dead code, or scope `frame-ancestors` per path.

---

### SEC-009 — CSP allows `unsafe-inline` and `unsafe-eval` · **P2** · OPEN

Standard for this Next.js configuration and explained in a comment, but it is the difference between "CSP mitigates XSS" and "CSP mitigates exfiltration". `connect-src 'self'` is doing the real work — an injected script has nowhere to send data. Worth revisiting when the framework emits nonces.

---

### SEC-010 — Stripe webhook security unverified · **P2** · UNVERIFIED

Signature verification with a 300-second tolerance and replay neutralisation via a unique index on `(provider, provider_event_id)` claimed *before* handling are both present and correctly shaped in source. **No forged, replayed or duplicated event was executed**, because no webhook secret exists here. Classified UNVERIFIED rather than PASS, per the standard set at the top.

---

## 6–20. Domain assessments

See `SECURITY_REALITY_MATRIX.md` for the per-control table with evidence. Summary of the areas not already covered by a finding:

**Tenant isolation.** The strongest area. 12 endpoints probed with a second merchant's session: `403` on every forged `businessId`, `404` when naming another tenant's customer id under one's own workspace. The 404/403 split is itself correct — 404 for "not yours or not real" avoids an existence oracle.

**Authentication.** Sessions are database rows keyed by `sha256(secret)` with `expires_at` and `revoked_at` checked on every resolve, so revocation is immediate and there is no window where a stateless token outlives its row. Cookie is `httpOnly`, `sameSite=lax`, `secure` in production. Verified live: a cookie captured before logout returns `401` after.

**Authorization.** Permissions are declared per route and checked before the handler. `customers:write` is staff-and-above, `customers:delete` admin-and-above — the split is coherent (recoverable vs not). Seat caps, owner-immutability and single-use invitations are all enforced server-side and covered by `verify:functional`.

**Public endpoints.** Twelve, each rate-limited and schema-validated. The join page strips the tenant primary key before it reaches the client; the card payload carries no email, phone, birthday, address or `business_id`. Enrolment responses are identical for new and existing customers, so the endpoint is not a customer-list oracle.

**Database integrity.** `db:verify`: **234 pass, 28 warnings, 0 fail**, `orphans=0 duplicates=0 impossible=0`. RLS is deliberately absent (migration `000018`) — isolation is application-layer, which is a real architecture, not an omission, but it means a query that forgets its filter has no second line of defence. That is precisely why SEC-002 mattered.

**Uploads.** PNG/JPEG/WebP, decided by magic number rather than the client's `Content-Type`, SVG explicitly excluded, size capped. One of the better-implemented areas.

**Secrets.** No live keys in source; `.env` gitignored and untracked; three `NEXT_PUBLIC_*` variables, all legitimately public (app URL, Stripe publishable key, VAPID public key).

**Legal claims.** No GDPR-compliant, ISO, SOC 2, PCI or encryption claims anywhere. The privacy policy is asserted against the implementation by an existing test — unusual and worth keeping.

**GDPR.** Erasure is real: `passimo_anonymize_customer` rewrites the email, sets `status='anonymized'`, clears notes, message bodies and survey comments, and preserves the immutable ledger. Card access dies with the status check. No verified subject-access *export* path — documented as a gap rather than claimed.

---

## 21. Known residual risks

1. Installed wallet passes cannot be revoked (SEC-004).
2. Card URLs are bearer credentials over monetary data (SEC-005).
3. The `X-Forwarded-For` fix depends on `TRUSTED_PROXY_HOPS` matching reality (SEC-001).
4. Rate limiting fails open on database faults (SEC-007).
5. No second line of defence below the application layer — no RLS.
6. Stripe, AI, wallet signing and messaging providers are all **unverified against real credentials**.

---

## 22. Production blockers

| # | Blocker | Why | Applies to |
|---|---|---|---|
| 1 | **SEC-006** — per-channel message metering | ~€2,000–4,000/month of provider cost is reachable within plan rules | Only if SMS/WhatsApp are enabled |
| 2 | **Set `TRUSTED_PROXY_HOPS`** for the Railway topology | the SEC-001 fix is configuration-dependent | Always |
| 3 | **Exercise Stripe webhooks against real events** | signature and replay logic never executed | Only if billing is live |
| 4 | **One live AI call per capability** | the integration has never run against the provider | Only if AI is enabled |

---

## 23. Recommended roadmap

**Before any real merchant:** items 1–2 above, plus fail-closed rate limiting on authentication buckets.
**Before real money:** item 3, and a decision on SEC-004 (wallet revocation) framed as a product promise rather than a technical one.
**Before scale:** RLS or an equivalent second layer; nonce-based CSP; subject-access export.
