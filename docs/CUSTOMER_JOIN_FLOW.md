# Customer join flow

How a person standing in a shop becomes a member of that shop's loyalty club.

This is the only journey in Passimo performed by someone who has never heard of
Passimo. Everything the merchant does — onboarding, the card designer, the brand
kit — exists to make this path work, and every loyalty feature downstream
(stamps, rewards, campaigns) only ever applies to someone who has completed it.

---

## The path

```
MERCHANT                                  CUSTOMER
────────                                  ────────
signs up
  ↓
default loyalty program provisioned
  ↓
join URL + QR available
  (dashboard · settings · onboarding · growth)
  ↓
prints / displays the QR       ───────▶   scans it with a phone
                                            ↓
                                          GET /join/{slug}          ← public, no login
                                            ↓
                                          server-rendered, merchant-branded
                                            ↓
                                          fills in email (+ optional name, birthday)
                                          ticks terms; marketing is separate and off
                                            ↓
                                          POST /api/v1/public/join  ← rate limited 10/min/IP
                                            ↓
                                          passimo_enroll_customer()
                                            ↓
                              ┌─────────────┴─────────────┐
                              ↓                           ↓
                        customers row              loyalty_accounts row
                        (business-scoped)          (one per active program)
                              ↓
                        signup activity event + welcome stamp
                        automation + webhook enqueued
                              ↓
                          signed card token (365 d)
                              ↓
                          GET /card/{token}         ← capability URL, no session
                              ↓
                   ┌──────────┴──────────┐
                   ↓                     ↓
            Apple / Google Wallet    browser card
            (credential-dependent)   (always works)
                              ↓
                        first visit → stamp → reward
```

---

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /join/{businessSlug}` | none | Public enrolment page. Server component; real 404 for an unknown or archived slug. |
| `POST /api/v1/public/join` | none | Enrolment. Rate limited (`publicStrict`, 10/60s per IP). |
| `GET /api/v1/public/business/{slug}` | none | The same read the page uses, for clients that want it as JSON. |
| `GET /api/v1/public/qr?data=…&size=…&download=1` | none | PNG QR renderer. **Only encodes URLs on this deployment's own origin.** |
| `GET /card/{token}` | capability token | The member's card. Client shell; data comes from the API below. |
| `GET /api/v1/public/card/{token}` | capability token | Card data. Rejects a forged or expired token with `400`. |
| `GET /u/{token}` | capability token | Short customer link. |

The merchant reaches the QR and link from **Settings**, **Growth**, and the last
step of **onboarding**. No new navigation was added — those already existed.

---

## Data model

```
businesses (slug, archived_at)
    │
    ├── loyalty_programs (is_default, is_active)
    │        │
    │        └── loyalty_accounts ──┐   unique (program_id, customer_id)
    │                               │
    └── customers ──────────────────┘   unique (business_id, email)
             │                          unique (business_id, phone) where phone not null
             ├── activity_events (signup)
             ├── loyalty_ledger (immutable — reversals only)
             └── referrals
```

There is no separate "membership" entity: **`loyalty_accounts` is the
membership**, and the card is a view over it. A customer row belongs to exactly
one business, so the same person joining two shops is two customer rows in two
tenants with no link between them — which is what keeps their histories from
mixing.

### Duplicate protection is in the database, not the application

| Constraint | Prevents |
|---|---|
| `customers_business_id_email_key` on `(business_id, email)` | two members with one email in one shop |
| `idx_customers_business_phone` on `(business_id, phone)` where not null | the same, by phone |
| `loyalty_accounts_program_id_customer_id_key` on `(program_id, customer_id)` | two memberships in one program |

`passimo_enroll_customer` upserts with `on conflict (business_id, email) do
update`, so a double tap, a genuinely concurrent double submit, and a re-scan
months later all converge on one member. The update `coalesce`s rather than
assigns, so re-joining never blanks details the merchant already has and never
resets progress.

---

## Program status and enrolment

A club is open when it has a **default program that is active**. There is no
separate "accepting members" flag and none is wanted: `loyalty_programs.is_active`
already exists, the merchant already toggles it, and a second status meaning
almost the same thing is how two sources of truth start disagreeing.

One predicate decides it — `getEnrollableProgram(businessId)` in
`lib/public/join.ts` — and both the page and the endpoint call it.

| Program state | `/join/{slug}` | `POST /api/v1/public/join` |
|---|---|---|
| Active default program | Form, branded, enrols | `200`, customer + loyalty account |
| No active default program | `200` with a **paused** panel, no form | `422` "not accepting new members", **nothing written** |
| Business archived / unknown slug | Real `404` | `404` |

**Paused is not 404.** The shop exists and its page is a real page; only
enrolment is closed. Saying the program "does not exist" would be wrong, and
would tell a customer the shop is gone while they are standing in it.

### The check is server-side, and re-read at submission

Hiding the form is not access control. The endpoint is public and
unauthenticated, so the guard that matters is the one in the route, and it reads
the program's state **during the enrolment request** — not at page load. That is
what closes the race where a merchant pauses the club while somebody has the
join page open: the form they already have is refused when they submit it.

It refuses *before* calling `passimo_enroll_customer`, which is deliberate. That
function has no opinion about whether a program is active — it inserts the
customer first and only then provisions accounts for active programs — so
letting it run against a paused club produces a member with no loyalty account:
a card with nothing behind it. Refusing first writes nothing at all.

---

## Identity model

```
Identity mechanism:   email, scoped to the business
Customer identifier:  customers.id (uuid), never exposed publicly
Authentication:       none at enrolment; a signed capability token afterwards
Session:              none — the card token is the credential
Recovery:             the merchant reissues the link; the customer re-scans the QR
Duplicate handling:   unique (business_id, email) + upsert, at the database
```

There is deliberately **no customer password and no customer account**. A
loyalty member is identified by a signed, long-lived capability URL produced at
enrolment. Issuing and checking both live in `lib/loyalty/card-token.ts`.

### Token architecture

Not a JWT — a compact purpose-scoped format, `<purpose>.<payload>.<signature>`:

| Property | Value |
|---|---|
| Algorithm | HMAC-SHA256 over `card.<payload>` |
| Secret | `env.security.tokenSecret` |
| Claims | `c` (customer uuid), `v` (token version), `exp` |
| TTL | 365 days |
| Comparison | constant-time |
| Purpose binding | inside the signed material |
| Tenant binding | **no business claim** — derived from the customer row |
| Revocation | `customers.status` (ends membership) or `v` (does not) |

**The TTL is long on purpose.** This URL is pasted into a wallet pass and an
email and is expected to work months later; a short-lived token would break the
card the moment it mattered. Depth of access is limited by rotation instead.

**PII:** the payload is base64url, not encryption — anything in it is readable
by whoever holds the link. It therefore carries an opaque id, a version and an
expiry, and nothing else. Name, email and phone are read from the row at request
time. Asserted by test: the claim set is exactly `['c', 'exp', 'v']`.

**Tenant binding:** there is no business, program or card claim to forge.
Changing `c` invalidates the signature; the business is read from the customer
row, so a token cannot be pointed at another tenant.

### Rotation — `customers.card_token_version`

The `v` claim is compared against the customer's current version on every public
read. `passimo_rotate_card_token(business_id, customer_id)` increments it, which
kills every link previously issued for that customer while the membership,
balance, history and wallet registration stay exactly where they are.

**Merchant-facing.** Customer → *Card link* panel (`components/customers/card-link-panel.tsx`),
behind `GET`/`POST /api/v1/customers/{id}/card-link`.

| Concern | How |
|---|---|
| Who can see the link | `customers:read` |
| Who can rotate | `customers:write` (staff and above) — it is recoverable; erasure stays at admin |
| Tenant safety | `defineRoute`'s `businessIdFrom` proves membership, the route re-checks the customer belongs to that workspace, and the SQL function checks the pair again |
| Wrong tenant | `404` — identical to a customer that does not exist, so the endpoint is not an existence oracle |
| Audit | `customer.card_link_rotated` in `audit_log`, with **no token, URL or version** |

The link is fetched on demand, not included in the customer profile response —
otherwise every customer page load would put a working credential into a
response nobody asked for.

Verified against a running instance:

```
unauthenticated                        → 401
merchant A rotates own customer        → 200, new link with v+1
merchant B rotates A's customer (B id) → 404
merchant B rotates A's customer (A id) → 403   (membership check fires first)
old card link 200 → 400 · old wallet link → 403 · new link → 200
customer status=active · balance unchanged · accounts unchanged
```

### What rotation does **not** revoke — read this before telling a merchant "it's revoked"

An **already-installed Apple or Google pass keeps working.** It authenticates to
the pass web service with `customers.wallet_auth_token`, a completely separate
credential that rotation does not touch, and `buildPassContent` mints a fresh
card token every time the pass updates — so the link embedded in the pass
repairs itself on the next sync.

Confirmed live, after rotating:

```
GET /api/v1/wallet/apple/v1/passes/…  Authorization: ApplePass <wallet_auth_token>
  → 302   (still authorised; re-issues the pass)
  → 401   with any other token
```

| Surface | After rotation |
|---|---|
| Browser card link (`/card/{token}`) | **Revoked** |
| Wallet *download* link (`/api/v1/wallet/{apple,google}/{token}`) | **Revoked** |
| Already-installed pass — updates, balance, stamps | **Keeps working** |
| Link embedded in that installed pass | Dead until the next sync, then self-heals |

So rotation answers "someone has the URL I emailed". It does **not** answer
"someone has the phone with the pass on it" — there is no pass-revocation
action today, and `wallet_auth_token` has no rotation path. That gap is real
and is listed under remaining risks rather than papered over; the confirmation
dialog says plainly that an installed pass keeps working.

Before this existed the only lever was moving the customer out of
`status = 'active'` — which the card route checks, and which also ends their
membership. The responses to a leaked URL were "do nothing" or "delete the
member".

Rotation is tenant-scoped: naming the wrong business returns null and changes
nothing. Tokens issued before the claim existed carry no `v`, which reads as 0 —
where every customer starts — so links already in customers' inboxes keep
working until somebody deliberately rotates them.

**Where the version is checked, and where it deliberately is not.** Only on the
public surfaces — `/card`, both wallet endpoints, proximity — where the token is
the whole authorisation. The merchant-side paths that also accept a card token
(`loyalty/earn`, `customers/lookup`, `lib/scan/resolve`) keep using `verifyToken`
directly: there it is an *identifier* answering "which customer is this?", and
the authorisation is the staff member's own authenticated, tenant-scoped
session. Rejecting a rotated token there would stop a shop serving a customer
standing in front of them, to prevent something the merchant's session already
permits.

---

## What the public card actually exposes

Taken from a live response, not from reading the types. Top-level keys:
`business`, `customer`, `loyalty`, `claimable`, `gift_cards`, `memberships`,
`wallet`.

| Field | On the public card | Sensitive | Spendable secret |
|---|---|---|---|
| `business.*` (name, slug, colours, city, website) | yes | no | no |
| `customer.name` (display name) | yes | **yes** — personal data | no |
| `customer.id` | yes | low — opaque uuid | no |
| `customer.member_since`, `is_vip` | yes | low | no |
| `customer.referral_code` / `referral_url` | yes | low — meant to be shared | no |
| `loyalty.programs[]` — balance, goal, progress, tier | yes | low | no |
| `loyalty.availableRewards[]` — name, cost, affordability | yes | no | no |
| `claimable[].name`, `expires_at` | yes | low | no |
| **`claimable[].code`** | yes | **yes** | **YES** — redeems a reward |
| **`gift_cards[].code`** | yes | **yes** | **YES** — spends money |
| **`gift_cards[].remaining_value`**, `currency` | yes | **yes** — monetary | no |
| `memberships[]` — plan name, perks, multiplier, renewal | yes | low | no |
| `wallet.apple` / `wallet.google` | yes | yes — card-token URLs | no |

Nothing else leaks: no email, no phone, no birthday, no address, no
`business_id`, no transaction history, no notes.

### The codes are deliberate, not an accident

This was checked rather than assumed. `app/card/[token]/page.tsx` renders both
in styled monospace blocks built for reading aloud at a counter (lines 195–197
and 224–226), and the route carries a comment explaining the intent: *"A gift
card someone bought them is money they already hold. Showing it on the card they
actually open is the difference between it being spent and it quietly
expiring."*

That is a considered product decision, so the codes stay. A gift card the
customer cannot show is a gift card that expires unspent — the card **is** the
customer's wallet, and the same is true of the paper gift card it replaces.

### Threat model

> **Bearer possession equals access.** Anyone holding a card URL can read the
> balance and the code of every active gift card on that customer, and the code
> of every claimed reward — and can spend them. The link does not expire in any
> practical sense (365 days) and is designed to be pasted into passes and
> emails.
>
> **Rotation is the revocation mechanism.** It is a response to a suspected
> leak, not a defence against one. Nothing detects a leak; a merchant has to be
> told.
>
> **Stronger customer authentication is required before anything more
> sensitive.** Stored value that can be topped up, payment instruments, identity
> documents, or any operation that *moves* money rather than displaying a code,
> needs per-session authorisation — not a longer-lived capability URL.

### Hardening applied

The three queries behind the sensitive half of this payload —
`reward_redemptions`, `gift_cards`, `customer_memberships` — now filter on
`business_id` as well as the customer.

A customer belongs to exactly one workspace, so the customer filter alone is
*currently* sufficient; that is a statement about today's data, not a boundary.
Nothing in the schema stops a `gift_cards` row owned by one business from naming
another business's customer as recipient — the foreign key proves the customer
exists, not whose it is — and `db:verify` checks `reward_redemptions → customer`
for exactly this drift while having **no equivalent check for `gift_cards →
recipient_customer` or `customer_memberships → customer`**. The three most
sensitive fields on a public, bearer-authenticated endpoint should not rest on
that.

### The limitation, stated plainly

> The bearer card token is acceptable for the current card surface **because it
> can now be revoked**. Anyone holding the URL still holds the card until it is
> rotated, and nothing tells the merchant a link has leaked. Rotation is a
> response, not a defence.

This is not hypothetical headroom. `GET /api/v1/public/card/{token}` **already**
returns `gift_cards.remaining_value` and `gift_cards.code`, plus the `code` of
every claimed reward redemption — money, and bearer secrets that can be spent.
Anything further in that direction (stored value that can be topped up, payment
instruments, identity documents) needs a real customer authentication step and
per-session authorisation, not a longer-lived capability URL. Rotation buys the
ability to respond to a leak; it does not make the link safe to leak.

---

## Tenant isolation

The endpoint is unauthenticated by necessity, so **every field in the body is
attacker-controlled**. The business is resolved from the slug in the URL and
from nothing else — there is no `businessId` in the request that could
contradict it.

| Attack | Result |
|---|---|
| Change the slug | Enrols into whatever public club that slug names. Not an escalation — joining is a public act. |
| Supply another tenant's `locationId` | **Dropped to NULL** (migration `000026`). Enrolment still succeeds. |
| Supply another tenant's `referralCode` | Ignored; no referral edge is created across tenants. |
| Forge a `programId` | Not accepted — programs are looked up from the business, never from the body. |
| Attach an account to a foreign program | `passimo_ensure_account` raises `check_violation`. |
| Forge or tamper with a card token | `400`, no data. |
| Read the tenant primary key from the page | `toPublicJoinData` strips `business.id` before it reaches the client. |

### Migration 000026 — the one defect found

`p_location_id` was written into `customers.signup_location_id` and
`activity_events.location_id` with no check that the location belonged to the
business. The foreign key proves the location exists, not whose it is.
Reproduced against a running instance: joining `madrid-coffee` while passing a
`barcelona-barber` location id returned `200` and wrote a cross-tenant reference
into Madrid Coffee's rows.

Nothing in the application reads that column today, so it was data corruption
rather than disclosure — but the first per-location signup report would have
surfaced one tenant's location inside another's dashboard. The guard coerces a
foreign location to `NULL` rather than raising, because the public join endpoint
must not turn away a customer at a counter over an optional analytics field.

---

## Consent and privacy

Loyalty enrolment and marketing consent are **separate**, and the separation is
enforced at three layers:

- `publicJoinSchema` defaults `marketing` to `false`.
- The form renders them as two distinct checkboxes; the terms box is required
  (`acceptedTerms: z.literal(true)`), the marketing box is not.
- `passimo_enroll_customer` records `consent_marketing`, `consent_source`,
  `consent_ip` and `terms_accepted_at` on the row.

Data collected is the minimum the club needs: email (required), first name and
birthday (both optional and labelled as such). No address, no surname is
demanded, no payment details.

---

## Wallet

| Provider | Status |
|---|---|
| Browser card (`/card/{token}`) | **Works with no configuration.** Always available. |
| Apple Wallet | **Credential-dependent.** Requires `APPLE_WALLET_*`. |
| Google Wallet | **Credential-dependent.** Requires the Google issuer configuration. |

The enrolment response returns `apple_wallet_url` / `google_wallet_url` as
**`null`** when the provider has no credentials, and the UI renders no button —
rather than a button that answers `503` on the last step of the funnel. There
are no invented certificates, issuer ids or passes anywhere in the codebase.

---

## Environment variables

| Variable | Default | Used for |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Every generated join URL, QR target and card URL. |
| `APPLE_WALLET_*` | unset | Apple passes. Absent ⇒ `apple_wallet_url: null`. |
| Google issuer config | unset | Google passes. Absent ⇒ `google_wallet_url: null`. |

`passimo.app` appears in no component or service. The public URL is read from
configuration everywhere.

### QR generation and the origin rule

The QR endpoint renders any URL you give it into a PNG, so it accepts **only
targets on this deployment's own origin** — `new URL(env.appUrl).origin`.
Without that rule it is a free phishing-image host on our domain: point it at a
lookalike bank, print the code, and the image is served by us.

The rule is not negotiable and must not be relaxed to make a broken image go
away. `tests/unit/qr-origin.test.ts` is the guard: it asserts that other hosts,
other ports, other schemes, lookalike hostnames and `download=1` are all
refused, and that a correctly configured origin still renders.

**The failure mode this creates.** `settings` and `onboarding` build the join
URL from `window.location.origin`, while the endpoint validates against
`NEXT_PUBLIC_APP_URL`. Serve the app on any origin that variable does not name —
a different port in development, a preview deployment, a proxy terminating on
another host — and every QR in the product `403`s at once. An `<img>` cannot
render a JSON error, so this used to surface as the browser's broken-image glyph
with no explanation.

`components/join/join-qr.tsx` is the single component all three surfaces now
use. On failure it renders a diagnosis naming `NEXT_PUBLIC_APP_URL` instead of a
glyph, and **the join link stays copyable** — the link is not what failed.

> **Set `NEXT_PUBLIC_APP_URL` to the real public origin in every deployment,**
> including local development on a non-default port. It is what every join URL,
> QR target and card URL is built from.

---

## Failure states

| State | Behaviour |
|---|---|
| Business not found | `/join/{slug}` renders the 404 boundary with a real `404`; the API returns `404`. |
| Business archived | Same as not found. |
| Invalid email / missing terms | `422` with a field-level message; the form shows it inline. |
| Rate limited | `429` after 10 requests per minute per IP. |
| Over plan customer limit | **Enrols anyway** and reports a soft limit to the owner. A customer at a counter is never turned away to sell an upgrade. |
| Already a member | Identical response to a new member — the endpoint is not a customer-list oracle. |
| Club paused | `/join/{slug}` renders a paused panel with no form; the endpoint returns `422` and writes nothing. |
| Expired, forged or **rotated** card token | `400`, "This link is invalid or has expired", plus how to get a new one. All three are deliberately indistinguishable — telling whoever holds a leaked URL which one it was would tell them whether to try again. |
| QR cannot be rendered | The panel names `NEXT_PUBLIC_APP_URL`; the join link stays copyable. |
| Wallet provider unconfigured | `null` URL, no button. |

No raw database error, stack trace, `undefined` or `null` reaches the customer.

### Deactivated program

Previously an edge case, now enforced — see **Program status and enrolment**
above. A paused club serves a real page that says it is paused, and the endpoint
refuses enrolment with `422` and writes nothing.

---

## Tests

| File | Covers |
|---|---|
| `tests/integration/public-join.test.ts` | 14 tests — page read, 404, archived, PK not leaked, enrolment, idempotency, concurrent double submit, no-overwrite on re-scan, multi-club, cross-tenant location, cross-tenant referral, foreign program, marketing consent default |
| `tests/integration/join-hardening.test.ts` | 15 tests — paused club closed/open, paused still serves a page, one shop pausing does not close another, why the RPC cannot be trusted alone; token issue/verify, tampered payload, tampered signature, wrong purpose, expired, rotation revokes, membership survives rotation, cross-tenant rotation refused, pre-rotation links still work, no PII in claims |
| `tests/unit/qr-origin.test.ts` | 6 tests — allowed origin renders, mismatched origin refused, attacker origins refused (other host, lookalike host, other port, other scheme), relative target refused, missing target refused, `download=1` is not a bypass |
| `tests/e2e/customer-join-journey.spec.ts` | 7 tests × desktop and mobile — QR is a real PNG, **a failed QR explains itself and leaves the link copyable**, page is public and branded, registration lands on the card, member bound to the right shop, card opens with no session, forged token refused |
| `tests/e2e/public.spec.ts` | unknown slug 404 |
| `scripts/verify-functional.mjs` | join page reachable for a newly created workspace |

The cross-tenant location test was verified to fail against the pre-`000026`
function and pass after it — the other 13 in that file pass either way, which is
what makes it a regression test rather than a restatement.
