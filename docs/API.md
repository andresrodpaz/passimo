# REST API

Base URL: `https://your-domain.com/api/v1`

---

## Authentication

Three schemes, all through `Authorization` (or a session cookie for the
dashboard):

```http
Authorization: Bearer psm_live_xxxxxxxxxxxx     # API key (integrations)
Authorization: Bearer <session token>            # native / mobile clients
Cookie: passimo_session=…                        # session (dashboard)
```

API keys are created in Settings → Developers, scoped to one business, and shown
exactly once. Only a SHA-256 hash is stored.

Scheduled endpoints authenticate with `x-cron-secret: $CRON_SECRET`.

---

## Conventions

- All request and response bodies are JSON.
- Every response carries `X-Request-Id`; quote it in support requests.
- Rate-limit state is returned in `X-RateLimit-Limit`, `-Remaining`, `-Reset`.
- List endpoints paginate with `limit` (max 200) and `offset`.
- Money and balances are returned as JSON numbers, already parsed.

### Errors

```json
{
  "error": {
    "code": "unprocessable",
    "message": "Not enough balance to redeem this reward",
    "details": [],
    "request_id": "2f9c…"
  }
}
```

| Code | Status | Meaning |
| --- | --- | --- |
| `validation_failed` | 422 | `details[]` lists `path` and `message` per field |
| `unauthorized` | 401 | Missing or invalid credential |
| `forbidden` | 403 | Authenticated, but the *role* lacks the permission |
| `payment_required` | 402 | Authenticated and authorised, but the *plan* does not include this. `details` carries `{ reason, feature \| limit, used, allowed, current_plan, suggested_plan }` |
| `not_found` | 404 | |
| `conflict` | 409 | Duplicate resource |
| `unprocessable` | 422 | Valid input, invalid business state |
| `rate_limited` | 429 | Honour `Retry-After` |
| `not_configured` | 503 | The capability has no credentials on this deployment |

Branch on `code`, never on `message`.

### Idempotency

Any endpoint that moves value accepts `idempotencyKey`. Replaying the same key
returns the original result with `"duplicate": true` and performs no second
mutation. Use a key per user intent, not per HTTP attempt.

---

## Counter

### `POST /scan`

The counter endpoint, and the one to reach for first. Send whatever the camera or
keyboard produced; the server decides what it was. With `action: "checkin"` it
also credits the visit, so identifying and awarding are a single round trip —
which is what keeps a scan inside a second on café wifi.

```json
{
  "businessId": "uuid",
  "raw": "9f8a7b6c-5d4e-3f2a-1b0c-9d8e7f6a5b4c",
  "action": "checkin",
  "amount": 12.50,
  "idempotencyKey": "scan-abc-123",
  "decodeMs": 180,
  "queuedAt": "2026-07-28T09:14:00.000Z"
}
```

`raw` accepts any of: a customer id (what wallet barcodes encode), a signed card
token or `/card/<token>` URL, a `passimo://customer/<id>` payload, a reward claim
code, a gift card code, a referral code, a `/join/<slug>` link, an email, a phone
number, or free text. Ambiguous human codes are probed against every table that
could own them, so the caller never has to declare a mode.

`idempotencyKey` is **required** for `action: "checkin"` — it is what makes
replaying an offline queue safe. `decodeMs` and `queuedAt` are optional telemetry:
they feed counter-speed logging and let a replayed scan be matched to its queued
entry.

The response is a discriminated union on `resolution.kind`:

| `kind` | Meaning |
| --- | --- |
| `customer` | One person, with the full counter view attached |
| `reward_claim` | A claim code; `fulfilled` is set when it was handed over |
| `gift_card` | Balance, status and whether it can be spent |
| `referral` | An existing member's referral code, with the advocate |
| `candidates` | Several possible people — the merchant picks |
| `join` | A sign-up link; this person is not a member yet |
| `unknown` | Nothing matched; `hint` is written to be read to a customer |

```json
{
  "resolution": {
    "kind": "customer",
    "customer": {
      "id": "uuid",
      "displayName": "María G.",
      "isVip": true,
      "visitCount": 24,
      "tierName": "Gold",
      "programs": [
        {
          "name": "Stamp card",
          "unitPlural": "stamps",
          "balance": 8,
          "goal": 10,
          "progressPercent": 80,
          "remainingToGoal": 2,
          "rewardAvailable": false
        }
      ],
      "rewards": [{ "id": "uuid", "name": "Free coffee", "cost": 10, "affordable": false }],
      "claims": [],
      "membership": null,
      "giftCardBalance": 0,
      "partnerOffers": [],
      "flags": {
        "firstVisit": false,
        "birthdayToday": false,
        "returningAfterLapse": false,
        "atRisk": false
      },
      "nextBestAction": "2 more stamps to their reward — tell them"
    }
  },
  "checkin": {
    "duplicate": false,
    "totalAwarded": 1,
    "awards": [{ "programName": "Stamp card", "amount": 1, "balance": 8 }],
    "rewardUnlocked": false,
    "skipped": []
  },
  "fulfilled": null,
  "queued_at": null
}
```

Permissions: `customers:read` to identify, plus `loyalty:earn` to check in. A
viewer can look someone up but not credit them.

### `GET /counter/roster?businessId=`

Recent visitors and regulars, so the merchant is never blocked when the camera is
unavailable. Returns `{ recent: [...], vip: [...] }` of customer summaries.
Deliberately small and cacheable — the service worker keeps it available offline.

Permission: `customers:read`.

---

## Loyalty

### `POST /loyalty/earn`

The main endpoint. Identify the customer however you can.

```json
{
  "businessId": "uuid",
  "customerId": "uuid",
  "trigger": "purchase",
  "amount": 12.50,
  "locationId": "uuid",
  "idempotencyKey": "pos-abc-123"
}
```

`customerId` may be replaced by `email`, `phone` or a scanned `cardToken`.

```json
{
  "duplicate": false,
  "customer_id": "uuid",
  "total_awarded": 2,
  "awards": [
    {
      "programName": "Stamp card",
      "unitPlural": "stamps",
      "amount": 2,
      "balance": 7,
      "goalAmount": 10,
      "rewardAvailable": false,
      "tierChanged": false
    }
  ],
  "claimable_rewards": { "granted": [], "affordable": [] },
  "skipped_rules": [
    { "ruleName": "Tuesday bonus", "reason": "outside_day_of_week" }
  ]
}
```

`skipped_rules` exists so a merchant can answer "why didn't that give a bonus?".

### `POST /loyalty/redeem`

Spend balance on a catalogue reward → `{ code, reward_name, cost, balance }`.

### `PUT /loyalty/redeem`

Fulfil a *granted* reward (birthday gift, win-back offer) by its code.

### `POST /loyalty/adjust`

Manual correction. Requires `loyalty:adjust`. Always audited.

---

## Customers

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/customers?businessId=&q=&segmentId=&sort=&limit=&offset=` | `customers:read` |
| `POST` | `/customers` | `customers:write` |
| `GET` | `/customers/{id}?businessId=` | `customers:read` |
| `PATCH` | `/customers/{id}` | `customers:write` |
| `DELETE` | `/customers/{id}?businessId=` | `customers:delete` (anonymises) |
| `GET` | `/customers/lookup?businessId=&q=` | `customers:read` |
| `POST` | `/customers/{id}/notes` | `customers:write` |
| `POST` | `/customers/import` | `customers:import` |
| `GET` | `/customers/export?format=csv\|json` | `customers:export` |

`/customers/lookup` is the type-ahead behind the counter scanner. It classifies
its input exactly as `POST /scan` does — so a pasted card URL or signed token
resolves instead of being searched for as a name — and returns a short ranked list
of the same `CustomerSummary` objects as `/counter/roster`, already carrying
balance and reward state. To get one definite answer *and* credit the visit in the
same request, use `POST /scan`.

`POST /customers/import` is two-phase. Without `mapping` it returns the detected
column mapping and a preview; with `mapping` it enqueues the import in chunks.

---

## Programs, rewards, segments

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/programs?businessId=` | Programs, rules, tiers and outstanding liability |
| `POST` `PATCH` | `/programs` | |
| `PUT` | `/programs` | Create or replace an earning rule |
| `GET` `POST` `PATCH` | `/rewards` | |
| `GET` `POST` | `/segments` | |
| `PUT` | `/segments` | Preview: matching count without saving |

---

## Commerce

### Gift cards

| Method | Path | Requires |
| --- | --- | --- |
| `GET` | `/gift-cards?businessId=&status=&search=` | `programs:read` + `gift_cards` |
| `POST` | `/gift-cards` | `programs:write` + `gift_cards` |
| `GET` | `/gift-cards/{id}?businessId=` | `programs:read` — card plus transaction history |
| `DELETE` | `/gift-cards/{id}` | `programs:write` — voids the unspent remainder |
| `GET` | `/gift-cards/redeem?businessId=&code=` | `loyalty:redeem` — balance check, no side effect |
| `POST` | `/gift-cards/redeem` | `loyalty:redeem` — spends; pass `idempotencyKey` |

The list response includes portfolio stats. `outstanding_value` is a
*liability*, not revenue: it is what customers can still spend.

Redemption failures are specific so a cashier can act:
`conflict` with a message for used-up, expired or cancelled cards; `not_found`
for an unknown code.

### Memberships

| Method | Path | Requires |
| --- | --- | --- |
| `GET` | `/memberships?businessId=&withMembers=true` | `programs:read` + `memberships` |
| `POST` | `/memberships` | `programs:write` — upsert a plan |
| `DELETE` | `/memberships` | `programs:write` — archives; existing members keep their benefits |
| `POST` | `/memberships/members` | `customers:write` — enrol a customer |
| `DELETE` | `/memberships/members` | `customers:write` — cancels at period end unless `immediately` |

Enrolment grants the plan's included balance through the ledger and applies its
earn multiplier on every subsequent award, multiplied with the customer's tier
multiplier. Renewal is a daily job; members are warned three days before.

---

## Growth and the network

| Method | Path | Requires |
| --- | --- | --- |
| `GET` | `/growth?businessId=&days=` | `analytics:read` — referrals, advocates, reputation, unresolved feedback, share assets, merchant referral |
| `POST` | `/growth` | `programs:write` — `update_referral_program` or `resolve_feedback` |
| `GET` | `/network?businessId=&search=` | `settings:read` + `coalition` |
| `POST` | `/network` | `settings:write` + `coalition` — `set_participation`, `invite`, `respond`, `update_permissions`, `end`, `upsert_offer` |

Only the invited business may accept an invitation, and directory reach is
bucketed rather than exact.

---

## Billing

| Method | Path | Requires |
| --- | --- | --- |
| `GET` | `/billing?businessId=` | `settings:read` — plan, live usage against every limit, catalogue |
| `POST` | `/billing/checkout` | `billing:manage` — returns a Stripe Checkout URL, or a portal URL when already subscribed |
| `POST` | `/billing/portal` | `billing:manage` |
| `POST` | `/billing/webhook` | Stripe signature — the only writer of subscription state |

The webhook verifies `Stripe-Signature` including timestamp tolerance, then
claims the event id in `subscription_events`. A replay returns
`{ received: true, duplicate: true }` without reprocessing.

`GET /billing` returns `tagline_key` and `highlight_keys` rather than sentences:
plan copy lives in the dictionary, so the marketing page and the billing screen
read the same words in whichever language the viewer chose.

### Dunning

A declined invoice starts a sequence rather than a single event. Stripe owns the
retries; `billing_dunning` owns the conversation.

| Stripe event | What happens |
| --- | --- |
| `invoice.payment_failed`, attempt 1 | Status → `past_due`. First warning by email and in the notification feed. Nothing else changes. |
| attempt 2 | Retry warning, with the attempt number Stripe is on. |
| attempt 3 | Final warning: says plainly what happens if the last attempt fails. |
| attempt 4, or `next_payment_attempt` is null | Plan → `lapsed`, status → `unpaid`. Reads keep working; every write meets one reactivation button. |
| `invoice.paid` | Any open sequence is closed and the merchant is told it worked. |

Three independent guards stop a merchant being emailed twice for one attempt:
the webhook rejects a replayed `event.id`, `billing_dunning` is unique on
`(business_id, provider_invoice_id)`, and the stage decision compares against
the last stage the merchant was actually told about.

Every message resolves `businesses.locale`, not the request locale — a webhook
has no reader whose cookie could answer that question.

### Onboarding

| Method | Path | Requires |
| --- | --- | --- |
| `GET` | `/onboarding?businessId=` | `settings:read` — checklist facts and whether it was dismissed |
| `PATCH` | `/onboarding` | `settings:write` — `checklistDismissed`, `lastStep` |

`GET` returns *facts*, not a verdict: six counts plus two booleans. Which items
are shown depends on the plan, and the plan is already resolved on the client, so
`resolveChecklist()` decides in one pure, tested function rather than half here
and half there. Completion is derived from those counts and never stored — a
stored flag drifts the moment a merchant undoes the thing.

### Notifications

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/notifications?businessId=&limit=` | Scoped to the signed-in user |
| `POST` | `/notifications` | Marks `ids` read, or everything when omitted |

---

## Campaigns and automations

| Method | Path | Notes |
| --- | --- | --- |
| `GET` `POST` | `/campaigns` | List includes open rate, click rate, attributed revenue and ROI |
| `GET` `PATCH` `DELETE` | `/campaigns/{id}` | Detail includes delivery breakdown and skip reasons |
| `POST` | `/campaigns/{id}/send` | `{ testCustomerId }` for a real preview; `{ scheduledAt }` to schedule |
| `GET` `POST` `PATCH` | `/automations` | |

Sends are asynchronous. The request enqueues and returns
`{ queued, reach, channels_used, channels_unavailable }`.

---

## Analytics and AI

`GET /analytics/overview?businessId=&days=30&include=cohorts`

Returns customers, revenue, engagement, NPS, monthly growth, a daily series, top
rewards, top customers and optionally cohort retention — in one call.

`POST /ai` with a discriminated `action`:

| Action | Returns |
| --- | --- |
| `campaign` | A ready-to-send draft from a one-sentence brief |
| `insights` | Prioritised, quantified recommendations |
| `segment` | A segment definition from natural language, plus its size |
| `optimize_program` | A verdict on the goal and concrete changes |
| `customer_summary` | Two sentences for staff before they say hello |
| `feedback_themes` | Themes and sentiment across survey comments |
| `rewrite` | Copy rewritten for a channel and an instruction |

Returns `503 not_configured` when `ANTHROPIC_API_KEY` is absent.

---

## Public endpoints (no authentication)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/public/business/{slug}` | Brand and program for the join page |
| `POST` | `/public/join` | Enrol. Requires `acceptedTerms: true` |
| `GET` | `/public/card/{token}` | The customer's own card |
| `GET` `POST` | `/public/unsubscribe` | Granular opt-out |
| `POST` | `/public/survey` | NPS/CSAT response |
| `GET` | `/public/qr?data=&size=` | QR PNG, own-origin URLs only |
| `GET` | `/public/gift-cards?slug=` | The business's gift card shop, or `enabled: false` |
| `POST` | `/public/gift-cards` | Starts a purchase; returns a Stripe Checkout URL. The card is minted by the webhook, never before payment |

`{token}` values are purpose-scoped HMAC capability tokens. They expire and
cannot be replayed against a different endpoint.

---

## Wallet

| Path | Purpose |
| --- | --- |
| `GET /wallet/apple/{token}` | Signed `.pkpass` download |
| `* /wallet/apple/v1/…` | Apple PassKit web service: registration, updates, logs |
| `GET /wallet/google/{token}` | Redirect to the Google Wallet save flow |

---

## Webhooks

### Outbound

Payload:

```json
{
  "id": "uuid",
  "type": "loyalty.earned",
  "created": 1767225600,
  "business_id": "uuid",
  "data": {}
}
```

Headers: `X-Passimo-Event`, `X-Passimo-Timestamp`, `X-Passimo-Signature`.

Verify with:

```
signature == "sha256=" + hmac_sha256(secret, timestamp + "." + rawBody)
```

Reject timestamps older than five minutes.

Events: `customer.created`, `customer.updated`, `loyalty.earned`,
`loyalty.expired`, `reward.redeemed`, `tier.changed`, `referral.qualified`,
`campaign.completed`, `survey.responded`, `gift_card.issued`,
`gift_card.redeemed`, `membership.started`.

Endpoints failing ten consecutive deliveries are disabled automatically.

### Inbound

```
POST /integrations/{provider}/webhook?business={businessId}
```

Providers: `stripe`, `square`, `shopify`, `woocommerce`, `sumup`, `zapier`,
`make`, `custom`. Each is signature-verified with that provider's own scheme.
Every purchase normalises into one idempotent pipeline, so replays never
double-award.

Generic shape for `zapier` / `make` / `custom`, authenticated with
`x-passimo-secret`:

```json
{ "id": "order-123", "email": "ana@example.com", "amount": 24.90, "currency": "EUR" }
```

---

## Scheduled

| Path | Cadence |
| --- | --- |
| `POST /jobs/run` | every minute |
| `POST /cron/daily` | daily |

`cron/daily` enqueues per-business stats, analytics and AI insights, plus four
global sweeps: balance expiry, membership renewal, renewal warnings and
scheduled gift card delivery. Nothing is executed inline, so the endpoint
returns in well under a second regardless of tenant count.

Header: `x-cron-secret: $CRON_SECRET`.

---

## Store locations

Every proximity feature needs a centre, so this is the prerequisite endpoint for the
whole wallet surface. Permissions: `locations:read` / `locations:write`.

```
GET    /locations?businessId=…&includeArchived=false
POST   /locations          { businessId, name, address?, lat?, lng?, … }
PATCH  /locations          { businessId, id, … }
DELETE /locations          { businessId, id }        → archives, never deletes
POST   /locations/import   { businessId, locations: [...] }
POST   /locations/geocode  { businessId, mode, address? | placeId? | lat+lng? }
```

A location carries its address, opening hours (several ranges per day), visibility and
primary flag — and its geofence: relevance radius, notification radius, optional outer
ring, entry/exit/dwell triggers with a dwell threshold, lock-screen copy, and an optional
iBeacon triple.

`DELETE` archives. Visits, scans and gift cards reference the site, and a merchant who
closes a shop still needs last year's numbers for it. The primary flag moves to another
site so a business is never left without one, and the last remaining location cannot be
archived.

`import` is idempotent on `externalRef` (falling back to name), so re-uploading a
corrected spreadsheet updates rows rather than doubling the estate. The plan cap is
checked against the *resulting* count before anything is written, so a merchant learns
their 40-store file needs Business before they get 15 stores and an error.

`geocode` modes: `geocode` (address to coordinates), `reverse`, `suggest` (Places
autocomplete), `details`. It returns `{ ok: false, reason: 'not_configured' }` with a
**200** when no Maps key is set — geocoding saves typing, it is not what makes proximity
work, so the form falls back to two number fields.

Every write queues a pass refresh across the business: a location added this morning is
worthless if it only reaches cards installed after it.

---

## Wallet and proximity

Permissions: `wallet:read` / `wallet:write`. See `docs/WALLET_PROXIMITY.md`.

### Settings

```
GET   /wallet/settings?businessId=…
PATCH /wallet/settings     { businessId, … }
```

`GET` returns everything the wallet screen needs in one round trip: the merchant's
settings, **which providers are configured on this deployment and exactly which
environment variable each is missing**, which proximity features their plan includes,
their locations with resolved geofences, and the template gallery.

Provider status is deliberately part of the response. A merchant whose Apple certificate
has not been installed should see *"Apple Wallet — not configured, missing
`APPLE_SIGNING_CERTIFICATE_PATH`"*, not a toggle that silently does nothing.

### Campaigns

```
GET    /wallet/campaigns?businessId=…&status=active
POST   /wallet/campaigns   { businessId, name, title, message, … }
PATCH  /wallet/campaigns   { businessId, id, … }
DELETE /wallet/campaigns   { businessId, id }        → archives
```

Feature: `proximity_campaigns`. The plan cap counts *active* campaigns, and only
*activating* consumes it — pausing is always allowed, so a merchant over their limit
after a downgrade can still turn things off.

### Automation rules

```
GET    /wallet/rules?businessId=…&activeOnly=true
POST   /wallet/rules       { businessId, name, conditions, actions, … }
PATCH  /wallet/rules       { businessId, id, … }
DELETE /wallet/rules       { businessId, id }        → archives
```

Feature: `automation_rules`. `GET` ships the rule **vocabulary** — which facts can be
tested, which comparisons exist, which actions can be taken, with a label for each — plus
the preset gallery. That is what lets the visual builder be generated rather than
hand-written, so adding a fact to the engine adds it to the UI, and the UI cannot offer a
condition the evaluator cannot run.

Every rule comes back with `summary`: the plain-language sentence generated from the
stored tree.

### Templates

```
GET  /wallet/templates
POST /wallet/templates     { businessId, templateKey, include? }
```

Ten industry strategies. Everything created arrives **paused** — a gallery button that
immediately starts pushing notifications to real customers is a support incident.

### Preflight

```
POST /wallet/preview       { businessId, campaignId, customerId?, locationId?, trigger? }
```

*Would this send, and if not, why?* Runs the real evaluator against a real customer and
returns **every** blocking reason, the rendered notification copy with tokens resolved,
and the literal `pass.json` and Google loyalty object — so a card can be verified before
any certificate exists.

### Analytics

```
GET /wallet/analytics?businessId=…&days=30
```

Permission: `analytics:read`. The funnel, derived rates, per-campaign and per-location
performance, a daily timeline, and the recent delivery log *including skips with their
reasons*.

Rates with no denominator are `null`, never `0` — "0% conversion" reads as failure where
"—" reads as "nothing sent yet". Visits count as conversions only when attributed to a
notification within six hours.

---

## Customer proximity (public)

Authenticated by the **signed card token**, not a session: the caller is an anonymous
customer on a public page, and the token carries the customer id, so they can only ever
report for themselves.

```
GET /public/proximity?token=…&lat=…&lng=…
```

Where the card can be used, what is on offer there, and whether each store is open.
**Read-only, evaluates nothing** — opening the card page must never be able to trigger a
notification.

```
POST /public/proximity     { token, lat, lng, accuracyMeters?, platform? }
```

A position report. Evaluates geofences and may send a notification. Rate limit:
`proximity`, 120 a minute. Returns only what a customer's browser has any business
knowing:

```json
{ "at_location": "Calle Mayor", "distance_meters": 84, "nearby": [], "notified": true }
```

```
PUT /public/proximity      { token, type, campaignId?, locationId?, platform? }
```

A client-reported funnel event — impression, click, wallet open, offer viewed, pass
installed or removed. These are the only funnel stages a server cannot observe, which is
why they are accepted from a client at all.

**Revenue is never accepted here.** It is attributed server-side from a real ledger entry;
a client-supplied figure would make the merchant's ROI column fiction.

---

## Platform administration

Deliberately outside `defineRoute`. That contract is built around a *business* scope — it
resolves `businessIdFrom`, checks a tenant role and a plan entitlement — and none of those
apply to a platform operator looking across every tenant. Bolting an "admin" bypass into
the tenant contract would put the most security-sensitive path in the product on the same
code path as the least.

Every endpoint begins with `requirePlatformAdmin()`.

```
GET    /admin/overview                    platform metrics, plan breakdown, capabilities
GET    /admin/businesses?q=…&plan=…       the business list with counts
GET    /admin/businesses?id=…             one business in full
PATCH  /admin/businesses                  { businessId, plan?, trialEndsAt?, reason }
GET    /admin/impersonate                 the impersonation audit trail
POST   /admin/impersonate                 { businessId, reason }
DELETE /admin/impersonate                 end the session
```

`reason` is **mandatory** on both writes. An unexplained plan change is indistinguishable
from a mistake, and an unlogged impersonation is indistinguishable from a compromise.

Both actions are written to the *merchant's* own audit log, not only ours: they are
entitled to see that support changed their plan or viewed their workspace, and why.

Impersonation expires after an hour, checked against the clock on every use rather than
trusted from the cookie, and is read-only by construction — the cookie names a business,
it does not mint a merchant session, so writes still fail `requireBusinessAccess`.
