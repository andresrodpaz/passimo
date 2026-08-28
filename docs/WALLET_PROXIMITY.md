# Wallet proximity

How a loyalty card comes back to a customer when they walk past the shop.

This is the feature that makes a wallet pass worth more than a plastic card: it is the
only marketing channel a small business gets that costs nothing per impression and
arrives at the moment of highest intent — fifty metres from the door.

---

## Contents

1. [What "proximity" means on each platform](#1-what-proximity-means-on-each-platform)
2. [Architecture](#2-architecture)
3. [The data model](#3-the-data-model)
4. [The proximity engine](#4-the-proximity-engine)
5. [Merchant configuration](#5-merchant-configuration)
6. [Analytics](#6-analytics)
7. [Credentials](#7-credentials)
8. [Running it without credentials](#8-running-it-without-credentials)
9. [Privacy](#9-privacy)
10. [Manual verification](#10-manual-verification)

---

## 1. What "proximity" means on each platform

The three delivery paths behave differently, and the differences drive the design.

| | Apple Wallet | Google Wallet | Web (card page) |
| --- | --- | --- | --- |
| Relevance mechanism | `locations[]` + `maxDistance` on the pass | `locations[]` on the loyalty object | `navigator.geolocation`, one reading |
| What the customer sees | The pass's own `relevantText` on the lock screen | An object message, via `addMessage` | Nearby stores and offers, in the page |
| Arbitrary notification copy | **No** | **Yes** (`TEXT_AND_NOTIFY`) | Yes |
| Location cap per pass | 10 | 10 | — |
| Per-location radius | One pass-level `maxDistance` | None | Ours |
| Beacons | Yes (iBeacon) | No | No |
| Requires install | Yes | Yes | **No** |

Two consequences worth internalising:

**Apple has no push message.** A pass update push carries no payload — it tells the
device "re-fetch this pass", and the device then calls our web service. The line a
customer reads on their lock screen *is* the pass's `relevantText`. So sending an Apple
proximity notification means writing the campaign copy into the pass and asking the
device to re-read it. `lib/wallet/service.ts` does exactly that before delegating to
the provider; the provider's `notify()` re-issues and pushes.

**The web path is not a fallback.** Roughly half of enrolled customers never install a
pass. Web geofencing on the card page reaches them through the same engine, which is
what makes proximity a property of the product rather than of a vendor SDK.

---

## 2. Architecture

```
                       ┌─────────────────────────────┐
   position report ───►│  lib/wallet/proximity.ts    │  the engine
   (customer browser)  │  reportPosition()           │
                       └──────────┬──────────────────┘
                                  │
        ┌─────────────────────────┼──────────────────────────┐
        ▼                         ▼                          ▼
  lib/wallet/geo.ts     lib/wallet/eligibility.ts   lib/wallet/rules.ts
  (pure: distance,      (pure: campaign             (pure: IF/THEN
   transitions,          eligibility, frequency      evaluation and
   coarsening)           guards, selection)          plain-language)
        │                         │                          │
        └─────────────────────────┼──────────────────────────┘
                                  ▼
                       ┌─────────────────────────────┐
                       │ lib/wallet/notifications.ts │  claim → deliver → record
                       └──────────┬──────────────────┘
                                  ▼
                       ┌─────────────────────────────┐
                       │   lib/wallet/service.ts     │  provider registry (DI)
                       └──────┬───────────────┬──────┘
                              ▼               ▼
                   providers/apple.ts   providers/google.ts
                              │               │
                    apple-pass.ts       google-loyalty-jwt.ts
                    apple-push.ts       google-sync.ts
                              │               │
                              └───────┬───────┘
                                      ▼
                          lib/wallet/pass-content.ts
                     (one provider-agnostic description
                       of what the card actually says)
```

### Modules

| File | Responsibility |
| --- | --- |
| `lib/wallet/geo.ts` | Distance, bounding boxes, geofence transitions, coordinate coarsening. Pure, isomorphic, 100% covered. |
| `lib/wallet/types.ts` | The contract between content, providers and orchestration. |
| `lib/wallet/eligibility.ts` | Campaign eligibility, frequency guards, campaign selection. Pure. |
| `lib/wallet/rules.ts` | The no-code IF/THEN engine, its vocabulary, and `describeRule`. Pure, isomorphic. |
| `lib/wallet/pass-content.ts` | Builds `WalletPassContent` — **the single source of truth for what a card says**. |
| `lib/wallet/service.ts` | The injectable provider registry: `issue`, `sync`, `notify`. |
| `lib/wallet/providers/apple.ts` | Apple delivery. `notify` re-issues and pushes. |
| `lib/wallet/providers/google.ts` | Google delivery. `issue` returns a redirect; `notify` sends an object message. |
| `lib/wallet/locations.ts` | Store locations, geofence resolution, opening hours, import. |
| `lib/wallet/settings.ts` | Merchant wallet configuration, with defaults. |
| `lib/wallet/campaigns.ts` | Proximity campaign store. |
| `lib/wallet/rule-store.ts` | Rule persistence and validation (kept apart from the engine so the engine stays client-importable). |
| `lib/wallet/proximity.ts` | The engine. One entry point: `reportPosition`. |
| `lib/wallet/notifications.ts` | Delivery ledger, deduplication, copy rendering. |
| `lib/wallet/events.ts` | The funnel recorder and visit attribution. |
| `lib/wallet/analytics.ts` | Funnel, rates, per-campaign and per-location performance. |
| `lib/wallet/sync.ts` | Queued pass refresh, per customer or per business. |
| `lib/wallet/geocoding.ts` | Address → coordinates. Optional; degrades to manual entry. |
| `lib/wallet/templates.ts` | Ten industry strategies (settings + campaigns + rules). |

### Why providers are injected

`createWalletService({ providers })` takes its providers as an argument. Three reasons:

1. The whole stack is testable with fakes and no credentials — which is the state this
   repository ships in, and therefore the state that has to work.
2. A third wallet vendor is a new file plus one registry entry, not a search for every
   `if (apple)`.
3. An unconfigured provider is *absent* rather than failing. A merchant who has
   completed Apple's onboarding but not Google's sees one button, which is correct.

### Why pass content is provider-agnostic

`buildPassContent()` returns one `WalletPassContent`, and both providers render from
it. Adding a field is a single change that lands on iPhone and Android simultaneously.
The alternative — each provider assembling its own view of loyalty state — is how the
two halves of a loyalty product drift until two customers standing next to each other
are shown different balances.

---

## 3. The data model

Migration `000015_wallet_proximity_and_paid_plans.sql`.

| Table | Purpose |
| --- | --- |
| `locations` (extended) | Geofence config, opening hours, visibility, lock-screen copy, beacons, geocoding provenance. |
| `wallet_settings` | One row per business. Every toggle a merchant owns. |
| `proximity_campaigns` | Trigger, schedule, audience, notification content, delivery limits, denormalised funnel counters. |
| `proximity_campaign_locations` | Location scope, consulted only when `all_locations = false`. |
| `proximity_rules` | The no-code IF/THEN rules, stored as a condition tree plus an action list. |
| `wallet_events` | Append-only funnel: crossing → suggestion → sent → impression → click → visit → redemption, with attributed revenue. |
| `wallet_notifications` | Mutable delivery state, and what frequency caps are enforced against. |
| `customer_device_positions` | One row per customer, replaced not appended. Coarsened to ~100 m. |
| `platform_admins`, `admin_impersonations` | Platform staff and the impersonation audit trail. |

### Two schema decisions

**Geofence config is resolved, not duplicated.** A location row holds *nullable*
overrides; `mapLocation()` merges them with the business defaults. A merchant who
changes the business-wide radius therefore changes every site that has not been
individually customised — which is what they expect, and what a
copy-defaults-on-write design silently fails to do.

**Events and notifications are separate tables.** `wallet_events` is an append-only
analytics stream; `wallet_notifications` is mutable delivery state (`queued → sent →
skipped → failed`). Conflating them would mean either an analytics table with
mutable rows or a delivery ledger you cannot correct.

---

## 4. The proximity engine

`reportPosition()` in `lib/wallet/proximity.ts`, in order:

1. **Kill switches.** `GOOGLE_GEOFENCING_ENABLED` (operator), then
   `wallet_settings.proximity_enabled` / `geofencing_enabled` (merchant).
2. **Candidate locations.** Bounding-box pre-filter in SQL, then exact haversine.
3. **Transition classification.** `classifyTransition()` compares the reading with the
   stored previous state.
4. **Persist position.** Coarsened, replaced, with the dwell anchor preserved.
5. **Record the crossing** in `wallet_events`.
6. **Assemble customer facts** — once, reused by every campaign and rule.
7. **Frequency guard** — quiet hours, daily cap, minimum gap.
8. **Run the merchant's rules.** These run *even when a notification is suppressed*:
   tagging a customer or alerting staff that a VIP walked in is not a notification and
   must not be silenced by a quiet-hours setting meant for pushes.
9. **Select a campaign** — highest priority, ties broken towards specificity.
10. **Send**, with a dedupe key derived from the crossing.

### The three problems it exists to solve

**Phones are noisy.** A device at a boundary reports crossings continuously.
`classifyTransition` is stateful and applies a 25 m hysteresis band: entry fires only
on a genuine transition, and leaving requires *clearing* the radius rather than
wobbling across it. Without this a phone on a table 210 m from a 200 m fence generates
dozens of notifications an hour.

**A deleted pass is unrecoverable.** There is no re-permission flow for a wallet card.
Every guard therefore fails *closed*: `notificationPressure()` returns maximum pressure
on a read error, because losing one notification costs less than losing the card.

**Duplicate crossings must be free.** The dedupe key buckets by the campaign's own
cooldown:

```ts
bucket = floor(now / (cooldownHours * 3_600_000))
key    = `${campaignId}:${customerId}:${locationId}:${trigger}:${bucket}`
```

A unique index on `wallet_notifications.dedupe_key` then enforces the cooldown as a
side effect: two crossings inside one window produce the same key, so the second
insert conflicts and is dropped. No lock, no cleanup job, correct across concurrent
requests from several devices.

---

## 5. Merchant configuration

Everything below is editable in the dashboard. **No wallet behaviour requires a code
change, a deploy, or an environment variable.** The only purpose of environment
variables is credentials and infrastructure.

### `/dashboard/locations`

Unlimited stores (subject to plan), each with: address, geocoding, coordinates,
opening hours (multiple ranges per day), visibility, primary flag, display order,
external reference, and per-site geofence configuration:

- relevance radius (when the card surfaces)
- notification radius (when a campaign may fire — often wider)
- optional outer ring
- entry / exit / dwell triggers, with a dwell threshold
- lock-screen copy for that specific store
- iBeacon UUID / major / minor

CSV import is idempotent on `external_ref`, so re-uploading a corrected spreadsheet
updates rows rather than doubling the estate.

### `/dashboard/wallet`

Five tabs:

| Tab | What a merchant controls |
| --- | --- |
| **Settings** | Master switches, wallet suggestions (Apple lock screen, Google, nearby, automatic updates, dynamic content, reward notifications, loyalty reminders), frequency caps, quiet hours, branding, pass expiry. Live card and lock-screen preview. |
| **Campaigns** | Trigger, radius, dates, weekdays, hours, locations, segment, tier, points, visits, recency, VIP, birthday-only, reward-ready-only, title, message, emoji, CTA, colours, expiry, priority, cooldown, send cap. Live preview and a **preflight**. |
| **Rules** | The visual IF/THEN builder plus a preset gallery. |
| **Analytics** | The funnel, rates, per-campaign and per-location performance, and the delivery log. |
| **Templates** | Ten industry strategies, applied in one click. |

### The preflight

`POST /api/v1/wallet/preview` answers *"would this send, and if not, why?"* against a
real customer using the real evaluator, and returns **every** blocking reason.

Without it a merchant configures a campaign, receives nothing, and cannot tell "the
feature is broken" from "my own rule excluded everybody". That ambiguity is what makes
proximity marketing feel unreliable in every product that ships it without a test
button. The response also includes the literal `pass.json` and Google loyalty object,
so a card can be verified before any certificate exists.

### The rule builder

A merchant assembles `IF distance ≤ 100 m AND points ≥ 50 THEN notify reward available`
from dropdowns, and reads back a generated sentence:

> If distance from the store is at most 100 m and points balance is at least 50, then
> tell them a reward is available.

That sentence comes from `describeRule()` — the same function the API and the rule list
use — so what the merchant reads is generated from what will run. A hand-written
description could drift from the logic; a generated one cannot, and that is what makes
a no-code builder trustworthy rather than merely convenient.

The builder's vocabulary comes from the engine's own exported constants
(`RULE_FACTS`, `RULE_OPERATORS`, `RULE_ACTION_TYPES`), so adding a fact to the engine
adds it to the UI, and the UI cannot offer a condition the evaluator cannot run.

**Facts:** distance, points, visits, tier, days since visit, VIP, birthday,
anniversary, claimable reward, pass installed, trigger, weekday, hour, location,
segment, notifications today.

**Actions:** suggest wallet card, send wallet notification, notify reward available,
activate campaign, grant points, grant reward, add tag, set VIP, notify staff.

### Templates

Ten industries: coffee shop, bakery, restaurant, barber shop, beauty salon, gym, retail
store, pet shop, pharmacy, supermarket. Each carries settings, campaigns and rules
tuned to how that trade actually works — a café's radius is 120 m and its window is the
morning commute; a gym's is 600 m and its trigger is *absence*; a pharmacy sends almost
nothing, because trust matters more than frequency there.

**Everything a template creates arrives paused.** A gallery button that immediately
starts pushing notifications to real customers is a support incident, not a feature.

---

## 6. Analytics

`GET /api/v1/wallet/analytics` returns the funnel, derived rates, per-campaign and
per-location performance, a daily timeline and the recent delivery log — in one
request, because these answer a single question and five endpoints would mean five
loading states on one screen.

### Honesty rules

- **Conversion is attributed, not assumed.** A visit counts only when its event carries
  a `source_event_id` back to a notification inside a 6-hour window. A regular's daily
  coffee is not a conversion, and counting it would report a rate we have not earned.
- **A rate with no denominator renders `—`, never 0%.** "0% conversion" reads as
  failure; "—" reads as "nothing sent yet", which is the truth on day one.
- **Revenue with no configured amounts renders "not measured".** "$0 returned" is a
  different and much worse claim than "we do not know".
- **Skipped notifications are shown with their reasons.** A quiet week with
  "48 skipped — card not in their wallet" is diagnosable; one showing only successes is
  a mystery.

### Tracked

Notification impressions · wallet suggestions · wallet opens · notification clicks ·
store visits · reward redemptions · campaign conversion rate · average visit delay
after notification · revenue generated · revenue per notification · passes installed
and removed · geofence crossings · unique customers reached.

---

## 7. Credentials

See `.env.example` for the full list with instructions. Certificates may be supplied
inline as PEM (`*_PEM`, suits Vercel/Fly) **or** as a mounted file path (`*_PATH`,
suits Docker/Kubernetes).

**Apple Wallet** — `APPLE_TEAM_ID`, `APPLE_PASS_TYPE_IDENTIFIER`,
`APPLE_WWDR_CERTIFICATE_PATH`, `APPLE_SIGNING_CERTIFICATE_PATH`,
`APPLE_SIGNING_PRIVATE_KEY_PATH`, `APPLE_SIGNING_KEY_PASSWORD`,
`APPLE_WALLET_ORGANIZATION_NAME`, `APPLE_WALLET_WEB_SERVICE_URL`,
`APPLE_WALLET_AUTH_TOKEN`, plus `APPLE_PUSH_KEY_P8` / `APPLE_PUSH_KEY_ID` for updates.

**Google Wallet** — `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_PROJECT_ID`,
`GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_WALLET_PRIVATE_KEY` (or the whole
`GOOGLE_WALLET_SERVICE_ACCOUNT_JSON`).

**Maps** — `GOOGLE_MAPS_API_KEY`, `GOOGLE_GEOCODING_API_KEY`,
`GOOGLE_PLACES_API_KEY`, `GOOGLE_GEOFENCING_ENABLED`.

`APPLE_WALLET_ORGANIZATION_NAME` falls back to each merchant's own business name, which
is almost always what you want; set it only for a white-label deployment.
`APPLE_WALLET_WEB_SERVICE_URL` defaults to `$NEXT_PUBLIC_APP_URL/api/v1/wallet/apple` —
these two getting out of sync is the most common reason a pass installs and then never
updates again.

---

## 8. Running it without credentials

The whole feature is exercisable before Apple or Google have approved anyone.

| Without credentials | What happens |
| --- | --- |
| Configure locations, geofences, campaigns, rules, templates | Works fully. |
| Preview the card and the lock-screen notification | Works — rendered from the merchant's real settings. |
| Preflight a campaign (`/wallet/preview`) | Works, and returns the literal `pass.json` and Google object. |
| Provider status in `/dashboard/wallet` | Shows exactly which environment variable is missing. |
| Web geofencing on the card page | **Works.** No wallet vendor involved. |
| Analytics | Works; the funnel fills from web events and seeded data. |
| Issue a `.pkpass` / Google save link | 503 `not_configured`, with the capability named. |

Filling in the variables and redeploying is the only remaining step.

Without `GOOGLE_MAPS_API_KEY` the location form drops its "find coordinates" button and
shows two number fields with a hint. That is a complete path, not a degraded one:
proximity works entirely from latitude and longitude, and Google's only job is to save
the merchant some typing.

---

## 9. Privacy

Asking a member of the public for their location is the most sensitive thing this
product does. Four rules:

1. **Nothing happens until the customer taps.** No `watchPosition` on mount, no prompt
   on page load. The button states its purpose and the copy states what we keep
   *before* the browser dialog appears.
2. **One reading, not a trail.** `getCurrentPosition`, not `watchPosition`. The question
   is "which shop is nearest right now".
3. **Coordinates are coarsened to ~100 m and the row is replaced, not appended.** We
   need "are they near a shop", never "where have they been". Privacy that depends on
   remembering to delete rows is not privacy. `coarsen()` derives its longitude step
   from the *rounded* latitude, which makes it idempotent — a stationary phone does not
   appear to drift.
4. **A refusal is not a dead end.** Denying location shows every store, unsorted, with a
   line saying that is fine.

Authenticated customer data is never written to the service-worker cache
(see `docs/STORE_EXPERIENCE.md`).

---

## 10. Manual verification

Camera and GPS cannot be asserted in CI, so these steps are run by hand.

### Without credentials (any machine)

1. `pnpm seed:demo`, then sign in as `growth@demo.com`.
2. `/dashboard/locations` — three Barcelona stores, each with coordinates, hours and a
   geofence. Edit a radius and save.
3. `/dashboard/wallet` → Settings — both providers report "not configured" with the
   missing variable named. Change the brand colour and watch the preview.
4. Campaigns → open one → **Would this send?** — a verdict and the blocking reasons.
5. Analytics — funnel, rates and the delivery log, including skips.
6. Templates — apply "Coffee shop"; campaigns and rules appear **paused**.
7. Rules — add a preset, then edit it and confirm the generated sentence matches.

### Web geofencing (a phone, or Chrome DevTools sensors)

1. Open a customer card: `/card/<token>`.
2. Tap "Show me the nearest store"; grant location.
3. Override the position to within the notification radius of a seeded store.
4. Reload — the store sorts first with a distance and an open/closed state.
5. Check `wallet_events` for a `geofence_enter` row.

### With credentials (real devices)

1. Add the pass to Apple Wallet from the card page; confirm locations are embedded
   (Xcode device console, or inspect the downloaded `.pkpass`).
2. Walk into the radius, or simulate a location on the device. The pass should surface
   on the lock screen with the store's `relevantText`.
3. Add the same card to Google Wallet on Android; confirm object messages arrive.
4. Change the balance at the counter and confirm both cards update.

### Known gaps

- **Physical device matrix.** iOS Safari 16 and older Android WebView code paths exist
  but have not run on that hardware.
- **Beacons are modelled, not verified.** The columns, the UI and the `pass.json`
  emission are complete; no iBeacon hardware has been tested against them.
- **Dwell triggers depend on report frequency.** A browser that stops reporting while
  backgrounded may not reach the dwell threshold; wallet-native relevance is
  unaffected.
