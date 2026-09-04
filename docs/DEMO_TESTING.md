# Testing Passimo

A practical walkthrough: get it running, then exercise every feature by hand, in
the order a merchant would meet them.

Written for someone with the repository and Docker and nothing else. Each step
names what you should see, so a step that does not look like the description is a
bug rather than a puzzle.

---

## Contents

- [Ten minutes to a working demo](#ten-minutes-to-a-working-demo)
- [The automated route](#the-automated-route)
- [1 · Sign in with each plan](#1--sign-in-with-each-plan)
- [2 · Onboarding, as a brand-new merchant](#2--onboarding-as-a-brand-new-merchant)
- [3 · Customers and CRM](#3--customers-and-crm)
- [4 · The counter — QR and manual scanning](#4--the-counter--qr-and-manual-scanning)
- [5 · Loyalty transactions](#5--loyalty-transactions)
- [6 · Rewards and redemption](#6--rewards-and-redemption)
- [7 · The wallet card](#7--the-wallet-card)
- [8 · Brand kit](#8--brand-kit)
- [9 · Campaigns and automations](#9--campaigns-and-automations)
- [10 · Analytics](#10--analytics)
- [11 · Feature gating, both directions](#11--feature-gating-both-directions)
- [12 · Trial and the paywall](#12--trial-and-the-paywall)
- [13 · Localization](#13--localization)
- [14 · Mobile and tablet](#14--mobile-and-tablet)
- [15 · The platform admin console](#15--the-platform-admin-console)
- [16 · Tenant isolation](#16--tenant-isolation)
- [Troubleshooting](#troubleshooting)

---

## Ten minutes to a working demo

```bash
pnpm install
cp .env.example .env          # the defaults are enough; nothing needs a real key
pnpm db:up                    # PostgreSQL 16 in Docker, on port 5433
pnpm db:migrate               # 24 migrations
pnpm seed:demo                # six workspaces, one per plan plus trial and lapsed
pnpm dev                      # http://localhost:3000
```

`pnpm setup` does the middle three in one command.

To test the **production** build instead of the dev server — which is what the
E2E suite and the functional harness should run against:

```bash
pnpm build
pnpm start                    # runs .next/standalone/server.js, exactly as the deployment does
```

`pnpm start` is deliberately not `next start`: `next.config.mjs` sets
`output: 'standalone'`, and Next says on every boot that `next start` does not
work with it. `scripts/serve-standalone.mjs` copies `.next/static` and `public`
into the standalone tree (Next does not, the Dockerfile does) and execs
`server.js`. `pnpm start:next` is still there if you want the other one.

### What you do not need

Nothing in this guide requires a credential. Stripe, Resend, Anthropic, Apple and
Google are all unconfigured, and every screen that depends on one **says so**
rather than pretending. That is itself worth checking: a product that fakes
success when a provider is missing is a product that will fake it in front of a
customer.

---

## The automated route

Before testing by hand, or instead of it when you only want to know whether
something regressed:

```bash
pnpm typecheck            # tsc --noEmit
pnpm lint                 # eslint
pnpm test                 # 650 unit tests
pnpm test:integration     # 82 tests against real PostgreSQL
pnpm db:verify            # 15 diagnostic files, PASS/WARNING/FAIL
pnpm build                # production build
pnpm verify:functional    # 939 checks over HTTP against a running server
pnpm test:e2e             # 158 Playwright tests, desktop + mobile viewports
```

`pnpm verify:full` composes the five that need no running server, reseeding before
`db:verify`. That order matters: the diagnostics describe the *demo* database, and
the E2E suite and the functional harness both sign up throwaway merchants whose
locations are never geocoded (there is no Maps key), which `012_locations.sql`
correctly reports as inert geofences. Run `pnpm seed:demo` after any test suite to
get back to a known state — it clears the residue as its first act.

`pnpm verify:functional` is the one that answers "does the product work". It signs
in as every demo account with a real session cookie and drives the whole product
over HTTP: plan detection, feature gating in both directions, tenant isolation,
onboarding resume, customer creation, loyalty earn, idempotency, redemption
limits, counter scanning in six payload formats, wallet design persistence,
campaigns, segments, analytics movement, locale switching, malformed input, SQL
injection and XSS probes, and a complete new-merchant journey from signup to a
first stamp appearing in analytics.

It needs a running server and a seeded database:

```bash
pnpm start &
pnpm verify:functional
BASE_URL=https://staging.example.com pnpm verify:functional   # against staging
VERIFY_ONLY=starter,pro pnpm verify:functional                # one or two plans
```

It creates its own fixtures, prefixed `zz-verify`, so re-running never corrupts
the curated demo data. `pnpm seed:demo` clears them afterwards.

E2E needs browsers once: `pnpm test:e2e:install`. Against an already-running
server, pass `E2E_BASE_URL=http://localhost:3000` so Playwright does not start a
second one.

---

## 1 · Sign in with each plan

Full credentials, per-plan test scripts and the verified feature matrix are in
[`DEMO_CREDENTIALS.md`](../DEMO_CREDENTIALS.md). In short — password
`PassimoDemo2026!` for all of them:

| | | |
| --- | --- | --- |
| `starter@demo.com` | $5 | Madrid Coffee — café, 1 site, stamp card |
| `growth@demo.com` | $19 | Barcelona Barber — 3 sites, campaigns, geofencing |
| `pro@demo.com` | $49 | Valencia Fitness — points, memberships, AI |
| `business@demo.com` | $99 | Sevilla Bakery — 4 sites, everything |
| `trial@demo.com` | trial | Bilbao Pizzeria — 9 days of Pro left |
| `lapsed@demo.com` | lapsed | Zaragoza Florist — the paywall |
| `admin@passimo.demo` | — | platform admin, `/admin` |

**What to check on each:** the workspace name in the sidebar is the right
business, the plan name is beside it, and the dashboard has numbers on it rather
than empty states.

---

## 2 · Onboarding, as a brand-new merchant

Do not use a demo account for this — the point is the path a real merchant walks
exactly once.

1. `/signup`. Email, password, name, business name.
2. You land on `/onboarding`. **Four steps, two skippable.**
3. **Business type.** Pick "Gym" or "Restaurant" deliberately — those are the
   presets that produce a **points** program, which is the case that used to be
   broken. Check that the goal and the reward suggestion change with the trade.
4. **Loyalty strategy.** Stamps or points, with a goal.
5. **Card design.** Template, colours, logo. The preview is the card.
6. **Location.** Address, city. Geocoding needs `GOOGLE_MAPS_API_KEY`; without it
   you can enter coordinates by hand.
7. **Activate.** You land at `/pos` with a QR to print.

**Then verify the program can actually be completed.** Open
`/dashboard/rewards` → Rules. On a points program you should see two active
earning rules:

```
Point per unit spent   purchase   per_currency   1 per 1
Point per visit        visit      fixed          1
```

If the only rule is `Stamp per visit — fixed — 1` on a 500-point goal, the card
needs 500 visits and the program is unreachable. That was a real defect: the
program *type* and its *earning rules* were set in two places that never spoke to
each other. `lib/loyalty/default-rules.ts` now derives one from the other.

### Resume

Interrupt it and confirm nothing is lost:

- Refresh mid-flow — the wizard returns to the same step.
- Sign out, sign back in — same step.
- Close the browser, reopen — same step.

Progress lives in `business_onboarding.last_step`, not in React state.

### First customer, first scan

1. `/pos` → **Add customer** → email and name.
2. Tap their name in the roster → the visit is recorded and the balance moves.
3. `/dashboard` → the visit appears in analytics.

---

## 3 · Customers and CRM

Sign in as `business@demo.com` — 1,240 customers, the best dataset for judging
whether the screens hold up.

`/dashboard/customers`:

- **Search** by name, email or phone.
- **Sort** by recent, name, spend, visits, balance, churn risk. Each changes the
  order; if one does not, it is not wired.
- **Filter** VIP, by tag, by segment, by RFM band.
- **Open a profile** — balance and progress, visit history, ledger with a reason
  per line, redemptions, notes, tags, referrals, consent state, churn risk,
  predicted lifetime value.
- **Add a note.** It appears immediately and the badge count on the list matches.
- **Mark VIP**, then filter by VIP and confirm they appear.
- **Block** a customer, then try to scan them at `/pos`. The counter must refuse
  with a translated reason. Unblock and confirm awarding resumes. (Blocking did
  nothing at all until this pass — a blocked customer was still credited on every
  scan, which made the one control against stamp-farming decorative.)
- **Export** — a CSV download. Rate-limited to five an hour on purpose; a sixth
  attempt returning 429 is the limit working.
- **Import** — `/dashboard/customers/import`. Paste or upload a CSV, map the
  columns, preview, commit. Duplicate emails resolve to the existing customer
  rather than creating a second row.
- **Delete** a customer. It **anonymises** rather than deletes: personal data
  goes, the ledger stays. That is what GDPR art. 17(3) allows and what the
  merchant's accounts need.

Segments (Growth and up) are on the same screen. Build `visit_count ≥ 2` and check
the count — 331 of Barcelona Barber's 420. Then raise the threshold and confirm
the count *falls*. A segment that returns the same number for every rule is not
filtering. (Every segment carrying a value matched zero customers until this pass;
see the [functional report](../FUNCTIONAL_VERIFICATION_REPORT.md).)

---

## 4 · The counter — QR and manual scanning

`/pos`. This is the screen staff use all day.

### In a browser, with a camera

Works on iPhone Safari, Android Chrome, iPad and a laptop webcam. The camera needs
a secure origin: `https://`, or `localhost` (which browsers treat as secure).
Over `http://` to an IP address the browser will refuse and the manual panel
takes over.

- **Continuous scanning** — the camera stays open between customers.
- **Torch** on a dark counter, **camera switch** on a device with two.
- **Sound** on each successful scan, so staff do not have to watch the screen.
- Point it at a customer's wallet pass, a printed card, a reward claim code or a
  gift card. **You never pick a mode first** — the server classifies whatever
  arrives.

### Without a camera — the supported fallback

The manual panel is not a degraded mode; it is what the E2E suite uses and what
staff use when the camera fails.

- **Customer lookup** by name, email, phone or loyalty card id.
- **Roster** — the customers most likely to walk in, one tap each.
- **Paste a code** read aloud over the counter.

### Payload formats, all of which resolve

| Format | Where it comes from |
| --- | --- |
| `card.<body>.<signature>` | a signed capability token, bare |
| `https://<host>/card/<token>` | the link in every email and wallet pass |
| `passimo:card/<token>`, `psm:card/<token>` | the custom scheme for pass generators that cannot embed links |
| `passimo:card.<body>.<signature>` | the same, concatenated — this used to fail |
| `fidelio:card/<token>`, `fid:...` | issued before the rename; a card in somebody's phone is not reissued because a company changed its name |
| a bare customer UUID | wallet barcodes |
| an email, `mailto:`, a phone, `tel:` | contact QR codes |
| `RW-…`, `GC-…`, `REF-…` | reward, gift card, referral codes |

### Edge cases worth trying

- **A random barcode** — a bottle, a book. You get "No member matches …" and
  nothing is credited. **200, not an error**: a 404 toast on every stray scan
  trains staff to ignore the screen.
- **The same customer twice in a row** — with the same idempotency key the second
  scan does not double-credit. Try it; the balance must not move.
- **A forged or expired token** — refused.
- **Another workspace's customer** — never resolves.
- **A blocked customer** — refused, with a reason.
- **Offline.** Turn off the network and keep scanning. Scans queue on the device
  and sync when you are back, with their original timestamps. `/offline` explains
  it. The service worker is at `/sw.js`.

---

## 5 · Loyalty transactions

From `/pos`, or `/dashboard/customers/{id}` → **Award**.

1. **Record a visit** — no amount. The balance rises by the visit rule.
2. **Record a purchase** with an amount. On a **stamps** program that is one
   stamp; on **points** it is the amount (1 point per €1). On Valencia Fitness
   (goal 500), a €42.50 purchase must credit **42 points, not 1**.
3. **Watch what moves.** The balance, the progress ring, `visit_count`,
   `lifetime_spend`, `average_ticket`, `last_visit`, the ledger, the activity feed,
   and reward eligibility — a customer crossing the goal gains a claimable reward.
4. **Adjust manually** — `/dashboard/customers/{id}` → Adjust. Needs
   `loyalty:adjust`. Requires a reason, and the reason appears in the ledger.
5. **Analytics move.** `/dashboard/analytics` — visits and revenue rise. Refresh
   and confirm; a figure that does not move is a figure that is not computed.

### Verify it in the database

```bash
docker exec -i passimo-postgres psql -U passimo -d passimo < scripts/db/007_transactions.sql
```

The invariant that matters: **balance equals the sum of the ledger**. It is the
first thing that section reports.

---

## 6 · Rewards and redemption

`/dashboard/rewards`.

1. **Create a reward** — name, description, cost, validity, per-customer limit,
   stock, minimum tier.
2. **Auto-granted rewards** — welcome, birthday, win-back — are handed out by
   automations rather than bought with balance. Every workspace has all three.
3. **Reach the goal.** Award until a customer crosses it; the reward becomes
   claimable and appears on their card.
4. **Redeem** from the profile or by scanning the claim code at `/pos`. Check: a
   redemption record is created with a code staff can read aloud, the balance is
   debited by exactly the cost, and the redemption appears in the customer's
   history.
5. **Try to redeem twice.** With a per-customer limit of 1 the second attempt is
   refused, with a translated reason rather than a raw error.
6. **Try to redeem what they cannot afford** — refused, naming insufficient
   balance.
7. **Replay the same redemption** with the same idempotency key — no second
   redemption is created.
8. **Analytics reflect it.** The redemption count rises and the reward stops being
   flagged "never claimed".

---

## 7 · The wallet card

`/dashboard/wallet`.

### Customisation

Change each of these and watch the preview:

- **Template** — ten trade presets (café, bakery, restaurant, barber, salon, gym,
  retail, pet shop, pharmacy, supermarket).
- **Card style** — solid, gradient, duotone, frosted. The demo spreads these
  across the plans so you can see the choice does something.
- **Progress rendering** — auto, bar, stamps, points, none. `auto` draws stamps
  for a stamp card and a bar for points.
- **Typography** — system, rounded, serif, mono.
- **Colours** — background, foreground, accent. Text is recomputed if a stored
  foreground fails WCAG AA against the background. On a gradient it must clear AA
  against **both** stops, because the copy crosses two colours.
- **Logo** and **banner** — 512 KB ceiling, enforced at the file picker in the
  merchant's own language. Upload and embed share one number, so a file that
  cannot reach the card is refused before it is accepted.
- **Visibility toggles** — member name, member since, tier, location, reward,
  progress.
- **Headline**, **custom message**, **terms text**.

Then: **refresh the page.** Everything persists. **Open
`/join/<slug>`** in a private window — the same palette. **Open the customer's
card page** — the same again.

The preview is not a mock. It renders through `resolveCardDesign`, the function
the pass builder calls, and shows Apple- and Google-style layouts with a QR
representation, customer details, balance and rewards.

### Provider readiness

The panel reports Apple and Google separately: configured, or the exact
environment variables missing. Without credentials **no real pass can be issued**
and the product says so rather than offering a button that fails. Add
credentials, restart, and the same screen reports them configured — no code
change.

### Proximity (Growth and up)

`/dashboard/wallet` → Notifications, Campaigns, Automation rules.

- Enable geofencing, set a radius per location, choose entry / exit / dwell
  triggers.
- Create a location-based campaign with a schedule, weekdays, time window,
  segment, minimum points or visits.
- Build a no-code rule: *IF a customer is within 250 m AND has a claimable reward
  THEN notify.*
- Quiet hours, daily caps and a minimum gap between notifications.
- `/dashboard/wallet` → Analytics shows the funnel: impressions, opens, clicks,
  visits, redemptions, attributed revenue.

---

## 8 · Brand kit

`/dashboard/settings` → Brand.

One record of business identity: name, description, logo, icon, cover, four
colours, font, contact fields, social handles.

Change the primary colour, then check **every** surface follows:

| Surface | How to check |
| --- | --- |
| Wallet card | `/dashboard/wallet/design` — the preview in the designer, or the callout on `/dashboard` |
| Public join page | `/join/<slug>` in a private window |
| Browser card page | The card URL from an enrolment |
| Public gift shop | `/gift/<slug>` |
| Outbound email | `pnpm test` covers the email shell; without Resend you cannot send one |
| Dashboard accents | The sidebar and buttons |

Luminance is implemented **exactly once**, in `lib/wallet/card-design.ts`, and a
unit test reads the source tree and asserts the WCAG coefficients appear nowhere
else. Three copies once disagreed, so one brand colour produced white text on the
installed pass and dark text on the join page advertising it. No test on any
single copy could catch that; only the count can.

---

## 9 · Campaigns and automations

Growth and up. `/dashboard/campaigns`.

1. **Create** each of the four kinds that matter: **welcome**, **reward
   reminder**, **win-back** (inactive customers), and a **VIP promo**.
2. **Segment** it. Attach "At risk" or build one inline, and check the reach count
   is a real number — not 0, and not the whole customer base.
3. **Channels** — email, SMS, WhatsApp, push, wallet. A campaign declaring a
   channel with no copy for it is refused rather than sending an empty message.
4. **Schedule** it, confirm it reads back as scheduled, then set it back to draft.
5. **Send.** Without `RESEND_API_KEY` this answers `not_configured`. That is the
   honest outcome; a fake success is worse.
6. **Validation** — a campaign with no name and no channel is refused.

`/dashboard/automations` — always-on rules. Three ship active per workspace
(welcome, birthday, win-back). Each has a trigger, an optional delay, an optional
segment, actions, and a cooldown so a customer is not re-enrolled every day.
Enrolled and completed counts, plus attributed visits and revenue, are on the
list.

`/dashboard/growth` — referrals, the leaderboard, review requests, NPS.

---

## 10 · Analytics

`/dashboard/analytics`.

| Metric | What to check |
| --- | --- |
| Visits, revenue | Record a purchase, refresh, watch them rise |
| Repeat rate, retention, churn | Differ per workspace — four businesses reporting the same rate would be a constant, not a coincidence |
| Average ticket, CLV | Match the customer table's own averages |
| Redemptions | Redeem a reward, refresh, watch it rise |
| Top rewards, top customers | Populated, and the ordering makes sense |
| Cohort retention | A grid with six monthly cohorts |
| Growth series | One point per month, twelve months of history |
| Daily series | One point per day — 31 for a 30-day window, so quiet days are not skipped |
| Wallet funnel | `/dashboard/wallet` → Analytics |
| Campaign attribution | Per campaign on the campaigns list |

To prove the numbers come from the data rather than from a constant:

```bash
docker exec -i passimo-postgres psql -U passimo -d passimo < scripts/db/013_analytics.sql
```

It recomputes each headline figure independently and compares.

---

## 11 · Feature gating, both directions

Both halves have to work, and they fail differently. A missing server gate is a
security bug; a missing client affordance is a pricing bug — the merchant never
learns the feature exists, so they never upgrade.

### Authorized

Sign in as `business@demo.com` and confirm every feature works. Then `pro@demo.com`
and confirm everything except coalition, SSO and team management works.

### Unauthorized

Sign in as `starter@demo.com`:

1. **The sidebar shows gated features with a lock**, rather than hiding them. That
   is deliberate: a merchant cannot want a feature they have never seen, so hiding
   paid features sells nothing.
2. **Navigate directly** to `/dashboard/campaigns`. The page loads — reads are
   never gated — and the action is refused.
3. **Call the API directly.** The frontend is not the boundary:

```bash
# Sign in and keep the cookie
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"starter@demo.com","password":"PassimoDemo2026!"}' \
  -c /tmp/starter.txt

BID=$(curl -s -b /tmp/starter.txt http://localhost:3000/api/v1/me \
  | python -c "import sys,json;print(json.load(sys.stdin)['businesses'][0]['id'])")

# A Growth feature, called straight at the API
curl -s -b /tmp/starter.txt -X POST http://localhost:3000/api/v1/campaigns \
  -H 'content-type: application/json' \
  -d "{\"businessId\":\"$BID\",\"name\":\"probe\",\"channels\":[\"email\"]}"
```

Expect **402** with a body that names the remedy:

```json
{"error":{"code":"payment_required",
  "message":"Starter does not include this. Available from Growth.",
  "details":{"reason":"feature","feature":"campaigns",
             "current_plan":"starter","suggested_plan":"growth"}}}
```

**402, not 403 and not 503.** 403 means the *role* was refused. 503 would mean the
deployment answered before the plan did — which was a real defect: the credential
check ran before authentication, so an anonymous stranger could learn whether this
deployment held an Anthropic key, and a Starter merchant clicking an AI button was
told the product was misconfigured instead of being sold an upgrade.

Verify the whole matrix at once:

```bash
pnpm verify:functional
```

It probes eight gated endpoints × six plans and asserts 402-with-a-remedy where
the plan lacks the feature and success where it does not.

---

## 12 · Trial and the paywall

### Trial — `trial@demo.com`

- The banner shows days remaining and a route to checkout.
- Pro features work. A trial is entitled to Pro on purpose: the features a
  merchant falls in love with should be the ones worth paying for, so the drop at
  day 14 is a felt loss.
- `GET /api/v1/billing` reports `stored_plan: "trial"`, `plan: "lapsed"` and
  `effective_plan: "pro"`. Read `effective_plan` for gating.

### Lapsed — `lapsed@demo.com`

This is the state that decides whether the product can charge at all.

1. **Every read works.** All 16 dashboard pages render. The customer list, the
   history and the analytics are intact. Confirm this first — it is the promise
   the reactivation wall makes.
2. **Every write is refused with one remedy.** Adding a customer, a campaign, an
   automation, a segment, a gift card: 402, naming the tier to reactivate from.
3. **A POS scan still works.** An existing customer at the counter gets their
   stamp. Losing a merchant's customers over a failed card is worse than losing
   the subscription.
4. `/dashboard/billing` shows the wall and the $5 entry price.

### Upgrade, downgrade, cancel

These need Stripe. Without credentials the billing screen **hides the checkout
button** rather than offering one that 503s. With `STRIPE_SECRET_KEY` and price
ids the flow is: checkout session → webhook → `applyPlan` → entitlements
invalidated → the dashboard reflects the new tier immediately. Dunning
(`lib/billing/dunning.ts`) handles a failed payment with a grace period rather
than dropping a paying customer the hour a bank declines a card.

---

## 13 · Localization

Two languages, Spanish (default) and English. The toggle is in the header;
`passimo_locale` is a cookie, so the **first byte** is already in the right
language — no flash of the wrong one.

Switch to Spanish and walk the whole product:

| Surface | Check |
| --- | --- |
| Landing page | Every section, the pricing table, the FAQ |
| Login, signup, reset | Labels, placeholders, validation messages |
| Onboarding | All four steps |
| Dashboard | Sidebar, every page, every table header |
| Customers | Filters, sort labels, the profile |
| Rewards, loyalty | Units — "sellos" vs "stamps", "puntos" vs "points" |
| Campaigns | Templates, channel names, the composer |
| Wallet | The designer, and the card face itself |
| QR / POS | The scanner, the roster, the manual panel |
| **Errors** | Trigger one — redeem without enough balance |
| **Empty states** | A new workspace with nothing in it |
| Notifications | The bell |
| Public join page | `/join/<slug>` |
| Legal | `/legal/privacy`, `/legal/terms` |

**No screen may mix the two.** If you find English in a Spanish interface, that is
a bug.

### How errors are localized

The API answers in one language because a route handler has no view and no
locale. The **browser** localizes from the error's `code` and its structured
`details`, in `lib/client/api-errors.ts`.

That covers the transport-level codes. It did *not* cover `unprocessable` and
`conflict`, which are the most common refusals in the product and the ones whose
meaning lives in the prose: "Not enough balance" and "This reward is out of
stock" share a code, so the code alone cannot produce a sentence. Those refusals
now carry a machine-readable `reason`:

```json
{"error":{"code":"unprocessable",
  "message":"Not enough balance to redeem this reward",
  "details":{"reason":"insufficient_balance"}}}
```

The English message is the last-resort fallback for the long tail. To check the
mechanism, switch to Spanish and try to redeem a reward the customer cannot
afford — the toast must be Spanish.

---

## 14 · Mobile and tablet

The counter is a phone screen. Test on a real device, or Chrome DevTools device
emulation, or `pnpm test:e2e` which runs the whole suite at a Pixel 7 viewport.

- **iPhone Safari** — the camera scanner, the wallet button, "Add to Home Screen".
- **Android Chrome** — the same, plus the Google Wallet button and the install
  prompt.
- **iPad / Android tablet** — the counter in landscape.
- **Laptop** — webcam scanning.

What to check: touch targets are thumb-sized, **no horizontal scroll at any
width** (an E2E test asserts this), forms use the right keyboard (`inputMode`),
the sidebar becomes a drawer that closes on navigation, tables become cards below
the `md` breakpoint, and the PWA installs from `/manifest.webmanifest` and opens
at `/pos`.

---

## 15 · The platform admin console

`admin@passimo.demo` → `/admin`.

- **Overview** — MRR, plan breakdown, workspaces, customers, scans in 30 days,
  wallet passes, plus which integrations this deployment has credentials for.
  MRR excludes trials.
- **Businesses** — all six workspaces, each on the tier it is actually using. The
  trial reads **Pro** with a **trial** badge, not "Inactive". (It read "Inactive"
  until this pass, which counted every live trial as churn.)
- **Impersonate** a merchant. The impersonation is written to
  `admin_impersonations` and shown under the Impersonation log tab, and the
  merchant's own audit log records it.
- **Change a plan** — written to the merchant's audit log with the reason, so they
  can see support did it and why.
- **Confirm the boundary.** Sign in as any merchant and open `/admin`: 403, and no
  other tenant's data appears anywhere.

---

## 16 · Tenant isolation

The check to run before any release.

```bash
pnpm db:verify 014        # ~50 relationship checks against the data
pnpm verify:functional    # 450 cross-tenant probes against the API
```

By hand:

1. Sign in as `starter@demo.com`, note the business id from `/api/v1/me`.
2. Sign in as `growth@demo.com` in another browser, note theirs.
3. As Starter, call every endpoint with Growth's business id — customers,
   analytics, rewards, campaigns, locations, wallet design, billing. **403 or
   404, every time.**
4. Harder: take a *customer id* from Growth and ask for it under **Starter's own**
   business id. That is the shape that defeats a naive `where id = ?`. It must 404.
5. Try to award points to that customer. It must refuse.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `DATABASE_URL is required` | `.env` is missing. `cp .env.example .env`. |
| `ECONNREFUSED 127.0.0.1:5433` | PostgreSQL is not running. `pnpm db:up`, then `docker compose logs postgres`. |
| `password authentication failed` on 5432 | A native PostgreSQL service is on 5432. The demo uses **5433** — check `POSTGRESQL_PORT` in `.env`. |
| `Migrations: N pending` | `pnpm db:migrate`. |
| `checksum mismatch` on migrate | An applied migration was edited. Restore it; add a new migration instead. |
| A demo password does not work | `pnpm seed:demo` resets it on every run. |
| `Too many failed attempts` | Five wrong passwords locks an account for 15 minutes, per account. Re-run the seed or wait. `scripts/db/003_users.sql` says exactly why an account cannot sign in. |
| 429 on export or import | `bulk` is five an hour, on purpose. |
| 429 on sign-in during a test run | `authSignIn` is 30 per five minutes per IP. Wait, or reuse one session. |
| Camera does not open | Needs `https://` or `localhost`. Use the manual panel. |
| "not configured" on a send, checkout or AI call | No credential for that provider. Expected, and honest. `/dashboard/settings` lists what is configured. |
| Analytics look empty on a new workspace | Nothing has happened yet. Record a visit. |
| Wallet buttons do nothing | No Apple/Google credentials. `GET /api/v1/wallet/design` names the missing variables. |
| `next start` warns about `output: standalone` | Use `pnpm start`, which runs the standalone server the deployment runs. |
| A test-created workspace in the admin console | `pnpm seed:demo` clears it. |

---

## Related

- [`DEMO_CREDENTIALS.md`](../DEMO_CREDENTIALS.md) — accounts, per-plan test
  scripts, the verified feature matrix.
- [`docs/DATABASE_VERIFICATION.md`](DATABASE_VERIFICATION.md) — the diagnostic
  query suite.
- [`FUNCTIONAL_VERIFICATION_REPORT.md`](../FUNCTIONAL_VERIFICATION_REPORT.md) —
  what was verified, what was fixed, what remains.
- [`docs/TESTING.md`](TESTING.md) — the test architecture.
- [`docs/ONBOARDING.md`](ONBOARDING.md) — why onboarding is four steps.
- [`docs/TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — operational problems.
