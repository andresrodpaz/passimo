# Passimo — demo accounts

Sign-in credentials for the local and staging demo environment: one workspace per
purchasable plan, plus the two lifecycle states no paid plan can reach.

**Status of this file.** Every plan, price, cap and feature column below is
generated from `lib/billing/plans.ts` — the same catalogue the API enforces — and
the numbers in the per-account tables are what `pnpm db:reset && pnpm seed:demo`
produces.

The end-to-end sign-in sweep last ran on 2026-09-02 against the previous
four-tier catalogue (939 checks, 0 failures). **The pricing v2 rebuild changed
the plans, the caps and two of the five workspaces, so that run no longer covers
this file.** Re-run `pnpm verify:functional` after seeding; the accounts,
passwords and sign-in paths are unchanged, and the plan-dependent assertions are
what needs re-confirming.

```bash
pnpm db:up          # PostgreSQL 16 in Docker
pnpm db:migrate     # 25 migrations
pnpm seed:demo      # the five workspaces below, plus the platform admin
pnpm build && pnpm start
```

---

## Safety

These are **development and staging credentials only.**

- The password comes from `DEMO_PASSWORD` in `.env`. It is a local development
  value; the seed refuses to run unless `NEXT_PUBLIC_APP_URL` points at localhost
  or `NODE_ENV=development` (override needs `--i-know-what-i-am-doing`).
- No production secret, API key, certificate or database password appears in this
  file or is needed to use any of it. Stripe, Resend, Anthropic, Apple and Google
  are all unconfigured in the demo and the product reports them as such rather
  than pretending.
- Demo customer addresses use `@example.com`; every address written by a test
  uses `.invalid`, an RFC 2606 reserved TLD that can never be registered. Nothing
  in the demo can send mail to a real person.
- `pnpm seed:demo` clears test residue before seeding, so the demo does not
  accumulate throwaway workspaces from verification runs.

| Variable | Purpose | Default |
| --- | --- | --- |
| `DEMO_PASSWORD` | The password for every account below. Minimum 10 characters — the same rule real accounts follow. | `PassimoDemo2026!` |
| `PLATFORM_ADMIN_EMAILS` | Comma-separated addresses granted cross-tenant admin. | `admin@passimo.demo` |

---

## The accounts

Password for all of them: the value of `DEMO_PASSWORD` (default
`PassimoDemo2026!`). Role: **owner**, except the last, which is a platform admin.
Sign in at `http://localhost:3000/login`.

| Plan | Price | Business | Email | Dashboard |
| --- | --- | --- | --- | --- |
| Starter | $29/mo | Madrid Coffee (café, Madrid) | `starter@demo.com` | `/dashboard` |
| Growth | $59/mo | Barcelona Barber (barber, Barcelona) | `growth@demo.com` | `/dashboard` |
| Pro | $99/mo | Sevilla Bakery (bakery, Sevilla) | `pro@demo.com` | `/dashboard` |
| Trial (→ Growth) | no charge for 14 days | Bilbao Pizzeria (restaurant, Bilbao) | `trial@demo.com` | `/dashboard` |
| Lapsed | not for sale | Zaragoza Florist (florist, Zaragoza) | `lapsed@demo.com` | `/dashboard` |
| Platform admin | — | all workspaces | `admin@passimo.demo` | `/admin` |

There is **no free plan.** The catalogue holds exactly three purchasable tiers, at
$29, $59 and $99. `trial` and `lapsed` are lifecycle states, not products:
`GET /api/v1/billing` never lists them as purchasable, and neither appears on the
pricing page.

A **trial is not a free plan.** `trial@demo.com` is on `businesses.plan = 'trial'`
with a future `trial_ends_at`, and `resolveEntitlements` gives it the full
**Growth** feature set for fourteen days. When the date passes it becomes
`lapsed`: reads keep working, writes answer 402, and nothing is deleted.

> **`pro@demo.com` used to be `business@demo.com`.** Pricing v2 folded the fourth
> $99 tier into Pro at the same price. The workspace kept its data, its four shops
> and its 1,240 customers, and changed only its plan id and its login.

> **About the counts below.** They are what a fresh `pnpm db:reset && pnpm seed:demo`
> produces. Running `pnpm verify:functional` or `pnpm test:e2e` afterwards nudges a
> few of them up by a handful: those suites record real visits and real
> redemptions, and the ledger behind them is append-only, so the probe customers
> are *anonymised* on the next seed rather than deleted. An append-only ledger and
> a shrinking customer table cannot both be true, and the ledger is the one that
> has to be. The shape of the data does not change.

---

### Starter — $29/month · Madrid Coffee

`starter@demo.com`

A one-site café on a stamp card: collect 8 stamps, get a free coffee.

| | |
| --- | --- |
| Program | Coffee Club — **stamps**, goal 8 |
| Customers | 140 (13 VIP, 96 opted into marketing) |
| Locations | 1 (Calle Mayor, Madrid) |
| Team | owner + 2 invited members (cap is 3) |
| Rewards | 6 active, 47 redemptions on record |
| Campaigns | 5 (1 active, 2 completed, 1 scheduled, 1 draft) |
| Referrals | 8 |

**Test these**

1. Sign in and read the dashboard — visits, revenue, retention, churn all
   populated from real rows.
2. `/pos` — scan a customer by email or tap a name from the roster. The camera is
   optional; the manual panel is the supported path on a laptop.
3. Award a stamp, watch the balance and the progress ring move, then redeem the
   free coffee at 8.
4. Customise the wallet card in `/dashboard/wallet` — template, style, colours,
   logo, banner — and watch the preview change. It renders through the same
   resolver the pass builder uses.
5. Open `/join/madrid-coffee` in a private window and enrol as a customer.
6. **The whole core product is here.** `/dashboard/campaigns` composes and
   schedules; `/dashboard/automations` has welcome, birthday and win-back running;
   `/dashboard/customers` builds and counts segments; the AI writes campaign copy
   (503 without `ANTHROPIC_API_KEY`, which is a credential answer, not a plan
   one). This is the point of the $29 tier: a café can actually run on it.
7. **Try a Growth feature.** Gift cards, multi-location, geofencing, proximity
   campaigns, automation rules and advanced analytics answer **402** naming the
   tier that includes them. Memberships and the partner network answer 402 naming
   Pro. The sidebar shows them with a lock rather than hiding them.
8. **Try to exceed a cap through the API, not the UI.**
   `POST /api/v1/locations` for a second site answers 402 with
   `suggested_plan: "growth"` regardless of what the client sends. So does a CSV
   import of more than 500 rows.

**Limitations**

- 500 customers, 1 location, 3 team members, 10 campaign sends a month, 2,000
  messages a month, 25 AI generations a month.
- No gift cards, multi-location, geofencing, proximity campaigns, automation
  rules, advanced analytics, memberships or partner network.
- Wallet *proximity* is included; **geofencing is not**, so the demo's
  `wallet_settings` row has geofencing off — deliberately, so the demo never
  shows a Starter merchant using something the API refuses.
- The billing screen reads "Not on this plan" for proximity campaigns and
  automation rules rather than showing a 0 / 0 meter, and names Growth and its
  price beside each.

---

### Growth — $59/month · Barcelona Barber

`growth@demo.com`

Three sites on a 10-cut card, with campaigns and geofenced wallet notifications.

| | |
| --- | --- |
| Program | Cuts Club — **stamps**, goal 10 |
| Customers | 420 (40 VIP, 282 opted into marketing) |
| Locations | 3 (Gràcia, El Born, Eixample) — all geocoded, all geofenced |
| Team | owner + manager + staff + viewer |
| Rewards | 6 active, 92 redemptions |
| Campaigns | 5 · Proximity campaigns 2 · Automation rules 3 |
| Wallet passes | 84 installed |
| Referrals | 31 |

**Test these**

1. Everything from Starter, plus:
2. `/dashboard/campaigns` — create a welcome, win-back or promo campaign, attach a
   segment, schedule it. Sending reports "not configured" because there is no
   email provider, which is the honest answer rather than a fake success.
3. `/dashboard/customers` — build a segment and check the count. `visit_count ≥ 2`
   matches 331 of the 420; a stricter rule matches strictly fewer. (This is worth
   exercising: it was returning 0 for every segment until this pass.)
4. `/dashboard/automations` — three are already active (welcome, birthday,
   win-back).
5. `/dashboard/locations` — three real Barcelona addresses with working geofence
   radii; change one and see the wallet rules follow.
6. `/dashboard/wallet` → Automation rules — the no-code IF/THEN builder.
7. `/dashboard/analytics` — cohort retention, churn risk, CLV and campaign
   attribution, all of which Starter does not have.
8. **Try a Pro feature.** Memberships and the partner network answer 402 naming
   Pro.
9. **This is the plan the trial runs on**, so it is also the account that shows a
   trialling merchant exactly what they are evaluating.

**Limitations**

- 5,000 customers, 3 locations, 10 team members, 50 campaign sends a month,
  15,000 messages a month, 300 AI generations a month, 15 proximity campaigns, 20
  automation rules.
- No memberships, partner network or priority support.

---

### Pro — $99/month · Sevilla Bakery

`pro@demo.com`

Four shops on a points program, with paid memberships, the partner network and
the AI surfaces. The largest dataset in the demo, and the right account for
judging whether the analytics screens hold up.

| | |
| --- | --- |
| Program | Bakery Rewards — **points**, goal 200, 1 point per €1 |
| Customers | 1,240 (71 VIP, 788 opted into marketing) |
| Locations | 4 (Triana, Centro, Nervión, Los Remedios) — of a 10 cap |
| Team | owner + admin + 2 managers + staff + viewer (cap is 25) |
| Rewards | 7 active, 164 redemptions |
| Campaigns | 5 · Proximity 3 · Automation rules 4 |
| Memberships | 2 plans (Daily Bread €24.90/mo, Coffee Club €12.50/mo), 74 members |
| Wallet passes | 50 installed |
| Referrals | 79 |

**Test these**

1. Everything from Growth, plus:
2. A **points** program rather than stamps. Record a €12.50 purchase at the
   counter and 12 points are credited — the earning rule is per-currency, not a
   flat 1 per visit. (This was flat-1 until an earlier pass, which made a
   200-point goal need 200 visits.)
3. `/dashboard/memberships` — two paid plans with earn multipliers and 74 members
   across `active`, `past_due` and `cancelled`. `stripe_price_id` is null because
   this deployment has no Stripe, which is the honest state rather than a fake
   subscription.
4. `/dashboard/network` — the partner network. **Empty in the demo, deliberately:**
   a coalition needs two entitled businesses, and Pro is the only tier that has
   the feature, so there is nobody for Sevilla Bakery to partner with. The screen
   renders, the API accepts an offer, and there is no seeded relationship to look
   at. Documented rather than fabricated.
5. `/dashboard/insights` — AI insights. Every AI route answers **503
   `not_configured`** without `ANTHROPIC_API_KEY`. The order is verified:
   anonymous gets 401, an over-quota merchant gets 402, and only an entitled
   merchant on an unconfigured deployment sees 503.
6. Four shops with managers scoped per location — the multi-site RBAC case.

**Limitations**

- 20,000 customers, 10 locations, 25 team members, 50,000 messages a month, 1,500
  AI generations a month, 50 proximity campaigns, 100 automation rules. Campaign
  sends are unlimited.
- **Not unlimited, on purpose.** The tier this replaced advertised `∞` on every
  cap; unlimited inference and unlimited SMS on a $99 subscription is how a SaaS
  acquires a customer it loses money on every month. The numbers above are large
  enough that no small chain reaches them and small enough that the margin holds.
- What is unavailable is unavailable to everybody: wallet passes need Apple/Google
  credentials, messaging needs Resend, checkout needs Stripe, AI needs Anthropic.
  All four report their own absence rather than pretending.

---

### Trial — 14 days of Growth · Bilbao Pizzeria

`trial@demo.com`

The state **every real merchant is in on day one**, and the only way to see the
trial banner and countdown.

| | |
| --- | --- |
| Stored plan | `trial` · effective plan **`growth`** · 9 days remaining |
| Program | Pizza Points — **points**, goal 150 |
| Customers | 45 · Rewards 6 · Redemptions 31 · Passes 18 |

**Test these**

1. The trial banner: days remaining, the plan being trialled by name, and a route
   to checkout. It says "you are on Growth", not "everything unlocked" — because
   the trial is Growth, and telling a merchant otherwise means they discover on
   day three that memberships were never included.
2. Growth features work — geofencing, gift cards, multi-location, advanced
   analytics. Memberships and the partner network answer 402 naming Pro, during
   the trial as well as after it.
3. **Trials are Growth rather than Pro on purpose,** and it is a commercial
   decision as much as a cost one. Growth is the plan we most want merchants to
   buy, so the fourteen days are spent inside the product actually being sold and
   the day-15 question is "keep this?" rather than "which of three things was I
   using?". A merchant who trials Pro learns to depend on memberships, then meets
   a $99 invoice for a café that needed $29 of software. Financially, a trial has
   no card on file, and Growth's 300 AI generations and 15,000 messages cannot be
   scripted into a bill.
4. `GET /api/v1/billing` reports `stored_plan: "trial"`, `plan: "lapsed"` (the
   billed-tier fallback) and `effective_plan: "growth"`. Read `effective_plan` for
   gating and `stored_plan` to tell "trialling" from "trial ended".
5. `/admin` → Businesses — the row reads **Growth** with a **trial** badge, not
   "Inactive", and MRR excludes it because there is no invoice behind it.

---

### Lapsed — not for sale · Zaragoza Florist

`lapsed@demo.com`

Where a workspace lands when a trial ends without a card. The only way to
exercise the paywall.

| | |
| --- | --- |
| Stored plan | `lapsed` · subscription `canceled` · trial ended 21 days ago |
| Program | Bloom Points — **points**, goal 120 |
| Customers | 60 · Rewards 6 · Redemptions 51 · Passes 21 |

**Test these**

1. **Every read still works.** All 16 dashboard pages render, the customer list is
   intact, analytics and history are all there. Nothing is hidden and nothing is
   deleted — that is the promise the reactivation wall makes.
2. **Every write is refused with one remedy.** Adding a customer answers 402;
   campaigns, automations, segments, gift cards and memberships all answer 402
   naming the tier to reactivate from.
3. **A POS scan still works.** An existing customer standing at the counter gets
   their stamp. Losing a merchant's customers over a failed card is worse than
   losing the subscription.
4. `/dashboard/billing` shows the reactivation wall and the $29 entry price. The
   wall says what is still there before it asks for money, which is the only order
   in which that sentence is true.
5. The billing screen shows `customers 60 / 0`. That is the state, not a bug: the
   cap of 0 is what refuses a *write*.

---

### Platform admin · `admin@passimo.demo`

Cross-tenant read access. `/admin`.

**Test these**

1. Platform overview — MRR, plan breakdown, workspaces, customers, scans, wallet
   passes. MRR excludes trials, because a trial has no invoice behind it, and
   yearly subscribers contribute their annual price over twelve rather than the
   monthly list rate. With the demo seed it reads $187/month: $29 + $59 + $99.
2. Businesses tab — all five workspaces, each on the tier it is actually using.
3. Impersonate a merchant; the impersonation is written to an audit trail
   (`admin_impersonations`) visible under the Impersonation log tab.
4. Change a plan and watch the merchant's own audit log record that support did it.
5. **Confirm the boundary.** Sign in as any merchant and open `/admin`: the API
   answers 403 and no other tenant's data appears.

---

## Feature matrix

Read from `lib/billing/plans.ts`, the same catalogue the API enforces. 402 =
refused with `payment_required`, naming the tier that includes it.

**This table has not been re-probed against a running API since pricing v2.** The
previous four-tier version was; `pnpm verify:functional` is what re-confirms it.
Every ✅ and 402 below follows from the catalogue, so a discrepancy would mean a
gate is missing rather than that this table is wrong — which is exactly what the
re-run is looking for.

| Capability | Starter $29 | Growth $59 | Pro $99 | Trial | Lapsed |
| --- | :--: | :--: | :--: | :--: | :--: |
| Dashboard, customers, CRM (read) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Add / edit customers | ✅ | ✅ | ✅ | ✅ | 402 |
| Loyalty program, rewards, redemption | ✅ | ✅ | ✅ | ✅ | ✅ scan only |
| QR scanner + manual fallback | ✅ | ✅ | ✅ | ✅ | ✅ |
| Wallet card designer | ✅ | ✅ | ✅ | ✅ | ✅ read |
| Brand kit — logo, colours, copy | ✅ | ✅ | ✅ | ✅ | 402 write |
| Wallet proximity (pass surfaces nearby) | ✅ | ✅ | ✅ | ✅ | 402 |
| Basic analytics | ✅ | ✅ | ✅ | ✅ | ✅ |
| Campaigns | ✅ | ✅ | ✅ | ✅ | 402 |
| Automations (welcome / birthday / win-back) | ✅ | ✅ | ✅ | ✅ | 402 |
| Segments | ✅ | ✅ | ✅ | ✅ | 402 |
| AI campaign copy, insights, segments | 503¹ | 503¹ | 503¹ | 503¹ | 402 |
| Gift cards | 402 | ✅ | ✅ | ✅ | 402 |
| Multi-location | 402 | ✅ | ✅ | ✅ | 402 |
| Geofencing (merchant-defined) | 402 | ✅ | ✅ | ✅ | 402 |
| Proximity campaigns | 402 | ✅ | ✅ | ✅ | 402 |
| Automation rules (no-code) | 402 | ✅ | ✅ | ✅ | 402 |
| Advanced analytics — cohorts, churn, CLV | 402 | ✅ | ✅ | ✅ | 402 |
| Daily automatic AI insights | — | ✅² | ✅² | ✅² | — |
| Memberships | 402 | 402 | ✅ | 402 | 402 |
| Partner network (coalition) | 402 | 402 | ✅³ | 402 | 402 |
| Priority support | — | — | ✅⁴ | — | — |

¹ **503, not 402.** AI is on every purchasable tier — the plans differ by
allowance (25 / 300 / 1,500 generations a month), not by access. The route is
fully implemented and reports `not_configured` because this deployment has no
`ANTHROPIC_API_KEY`. A merchant who has spent their monthly allowance gets 402
naming the tier with more.

² Gated on `advanced_analytics`, so Growth and above. The daily sweep also spends
one AI generation from the monthly allowance, which is why Starter's 25 belong to
the merchant's own campaign copy rather than to a background job.

³ Renders and accepts an offer, but the demo has no seeded partnership: a
coalition needs two entitled businesses and Pro is the only tier with the
feature.

⁴ An operational commitment (named contact, same-business-day first response),
not a code path. It carries an entitlement flag so it can appear on the pricing
card and in support tooling; nothing in the API checks it, and nothing should.

### Removed in pricing v2

Four features were advertised on the old top tier and implemented nowhere — no
route checked them and no screen unlocked behind them:

| Was sold as | Reality | Now |
| --- | --- | --- |
| Single sign-on | No implementation | Removed from the catalogue |
| REST API access | No implementation | Removed from the catalogue |
| Webhooks (outbound) | `lib/webhooks/deliver.ts` exists; nothing exposes it to a merchant | Removed from the catalogue |
| Team management | No invite endpoint, no team screen | Removed; seats are governed by the `team_members` cap, which every plan has |

They are gone rather than renamed. A merchant could have paid $99 for four things
that were never going to arrive.

### Limits

| Limit | Starter | Growth | Pro | Trial | Lapsed |
| --- | --: | --: | --: | --: | --: |
| Customers | 500 | 5,000 | 20,000 | 5,000 | 0 |
| Locations | 1 | 3 | 10 | 3 | 1 |
| Team members | 3 | 10 | 25 | 10 | 1 |
| Messages / month | 2,000 | 15,000 | 50,000 | 15,000 | 0 |
| AI generations / month | 25 | 300 | 1,500 | 300 | 0 |
| Campaign sends / month | 10 | 50 | ∞ | 50 | 0 |
| Proximity campaigns (active) | 0 | 15 | 50 | 15 | 0 |
| Automation rules (active) | 0 | 20 | 100 | 20 | 0 |

A cap of **0** means the plan does not include the feature at all, not that the
allowance is spent. The two are different sentences and the billing screen says
the right one: "Not on this plan — Growth includes 15, $59/month".

Every workspace in the demo sits comfortably inside its own caps. That is
deliberate: a demo account already over its limit teaches a reviewer that the
limits do not hold. `lapsed` is the exception, and it is the state working
correctly — its caps are zero because zero is what refuses a *write*.

---

## Customer states in the demo

Every state the dashboard has distinct UI for is present in every workspace, so
no screen renders as an empty state. Confirmed by
`scripts/db/006_customers.sql`.

| State | Where to find it |
| --- | --- |
| Active, frequent visitor | `/dashboard/customers?sort=visits` — top of the list |
| Close to a reward | `/dashboard/customers?sort=balance` — balance just under the goal |
| Reward available now | The "Reward ready" system segment |
| VIP, high lifetime value | `?vip=true`, or `?sort=spend` |
| Inactive / churn risk | `?sort=churn`, or the "At risk" and "Lost" segments |
| Recently registered | The "New this month" segment |
| Has redeemed more than once | Any customer with a redemption history |
| Referral customer | `source = 'referral'` — 8 to 79 per workspace, in all three referral states |
| Birthday-campaign eligible | The "Birthday this month" segment |
| Blocked | Set one from a customer profile, then try to scan them — the counter refuses with a translated reason |

Roughly two in three customers have marketing consent, with a timestamp. That
matters: the demo previously had none, so every campaign reported a reach of zero
and read as a broken product.

---

## What is not available, and why

Honest about the difference between *unimplemented*, *needs credentials* and *not
built*.

| Capability | Status | What it needs |
| --- | --- | --- |
| Apple Wallet pass issuing | **Credential required** | `APPLE_TEAM_ID`, `APPLE_PASS_TYPE_IDENTIFIER`, WWDR + signer certificates. Builder, web service, push registration and update endpoints are implemented and unit-tested. |
| Google Wallet pass issuing | **Credential required** | `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON`. Class/object mapping implemented. |
| Email / SMS / WhatsApp sending | **Credential required** | `RESEND_API_KEY` for email. Campaign composition, segmentation, scheduling, suppression and templates all work; the send reports 503. |
| Card payments and checkout | **Credential required** | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price ids. Checkout, portal, webhook and dunning implemented; the billing screen hides the checkout button rather than offering one that 503s. |
| AI insights and generation | **Credential required** | `ANTHROPIC_API_KEY`. |
| Address geocoding | **Credential required** | `GOOGLE_MAPS_API_KEY`. Locations can be geocoded by hand; the demo ships real coordinates. |
| Wallet card preview | **Implemented** | Renders through `resolveCardDesign`, the same function the pass builder calls. Labelled a preview because without credentials no real pass can be issued. |
| Camera QR scanning | **Implemented** | Needs a device with a camera and an HTTPS (or localhost) origin. The manual panel is the supported fallback and is what the E2E suite uses. |
| Per-location card variants | **Not built** | `wallet_card_designs` is keyed on `business_id`. A deliberate scope choice. |
| `coverUrl` brand field | **Half-wired** | Stored and editable; renders nowhere. |

---

## If a credential does not work

1. `pnpm seed:demo` resets the password on every run, so a database seeded weeks
   ago still matches this file.
2. Five wrong passwords lock an account for 15 minutes (per account, not per IP).
   Re-run the seed to reset it, or wait.
3. `psql "$DATABASE_URL" -f scripts/db/003_users.sql` reports exactly why an
   account cannot sign in — locked, suspended, unverified, or no password set.
4. `pnpm verify:functional` signs in as every account here and reports which one
   failed.
