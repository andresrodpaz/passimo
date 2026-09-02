# Passimo — demo accounts

Sign-in credentials for the local and staging demo environment, one workspace per
plan plus the two lifecycle states no paid plan can reach.

**Every credential in this file was used to sign in against a production build on
2026-09-02, and every workspace below was exercised end to end by
`pnpm verify:functional` in the same run (939 checks, 0 failures).** Nothing here
is documented but unverified.

```bash
pnpm db:up          # PostgreSQL 16 in Docker
pnpm db:migrate     # 24 migrations
pnpm seed:demo      # the six workspaces below
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
| Starter | $5/mo | Madrid Coffee (café, Madrid) | `starter@demo.com` | `/dashboard` |
| Growth | $19/mo | Barcelona Barber (barber, Barcelona) | `growth@demo.com` | `/dashboard` |
| Pro | $49/mo | Valencia Fitness (gym, Valencia) | `pro@demo.com` | `/dashboard` |
| Business | $99/mo | Sevilla Bakery (bakery, Sevilla) | `business@demo.com` | `/dashboard` |
| Trial (→ Pro) | $0 for 14 days | Bilbao Pizzeria (restaurant, Bilbao) | `trial@demo.com` | `/dashboard` |
| Lapsed | not for sale | Zaragoza Florist (florist, Zaragoza) | `lapsed@demo.com` | `/dashboard` |
| Platform admin | — | all workspaces | `admin@passimo.demo` | `/admin` |

There is **no free plan.** The catalogue holds exactly four purchasable tiers
starting at $5; `trial` and `lapsed` are lifecycle states, not products, and
`GET /api/v1/billing` never lists them as purchasable.

> **About the counts below.** They are what a fresh `pnpm db:reset && pnpm seed:demo`
> produces. Running `pnpm verify:functional` or `pnpm test:e2e` afterwards nudges a
> few of them up by a handful: those suites record real visits and real
> redemptions, and the ledger behind them is append-only, so the probe customers
> are *anonymised* on the next seed rather than deleted. An append-only ledger and
> a shrinking customer table cannot both be true, and the ledger is the one that
> has to be. The shape of the data does not change.

---

### Starter — $5/month · Madrid Coffee

`starter@demo.com`

A one-site café on a stamp card: collect 8 stamps, get a free coffee.

| | |
| --- | --- |
| Program | Coffee Club — **stamps**, goal 8 |
| Customers | 140 (13 VIP, 96 opted into marketing) |
| Locations | 1 (Calle Mayor, Madrid) |
| Team | owner + 1 invited staff member (cap is 2) |
| Rewards | 6 active, 47 redemptions on record |
| Campaigns | 5 drafts |
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
6. **Try a Growth feature.** Campaigns, automations, gift cards, segments,
   memberships and proximity all answer **402** naming the tier that includes
   them. The sidebar shows them with a lock rather than hiding them.

**Limitations**

- 500 customers, 1 location, 2 team members.
- No campaigns, automations, segments, gift cards, memberships, AI, geofencing,
  proximity campaigns, automation rules, API access or webhooks.
- Wallet *proximity* is included; **geofencing is not**, so the demo's
  `wallet_settings` row has geofencing off — deliberately, so the demo never
  shows a Starter merchant using something the API refuses.

---

### Growth — $19/month · Barcelona Barber

`growth@demo.com`

Three sites on a 10-cut card, with campaigns and geofenced wallet notifications.

| | |
| --- | --- |
| Program | Cuts Club — **stamps**, goal 10 |
| Customers | 420 (40 VIP, 282 opted into marketing) |
| Locations | 3 (Gràcia, El Born, Eixample) — all geocoded, all geofenced |
| Team | owner + manager + staff + viewer |
| Rewards | 6 active, 92 redemptions |
| Campaigns | 6 · Proximity campaigns 2 · Automation rules 3 |
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
7. **Try a Pro feature.** Memberships and AI answer 402 naming Pro.

**Limitations**

- 5,000 customers, 5 locations, 10 team members, 10 proximity campaigns, 10
  automation rules.
- No AI, memberships, advanced analytics, API access, webhooks, coalition, SSO or
  team management.

---

### Pro — $49/month · Valencia Fitness

`pro@demo.com`

A three-site gym on a points program, with memberships and the AI surfaces.

| | |
| --- | --- |
| Program | Training Points — **points**, goal 500, 1 point per €1 |
| Customers | 860 (51 VIP, 550 opted into marketing) |
| Locations | 3 (Ruzafa, Benimaclet, Port) |
| Team | owner + admin + 2 managers + staff + viewer |
| Rewards | 7 active, 207 redemptions |
| Campaigns | 6 · Proximity 3 · Automation rules 4 |
| Wallet passes | 46 installed |
| Referrals | 61 |

**Test these**

1. Everything from Growth, plus:
2. A **points** program rather than stamps. Record a €42.50 purchase at the
   counter and 42 points are credited — the earning rule is per-currency, not a
   flat 1 per visit. (This was flat-1 until this pass, which made a 500-point goal
   need 500 visits.)
3. `/dashboard/memberships` — paid membership plans with an earn multiplier.
4. `/dashboard/insights` — AI insights. Every AI route answers **503
   `not_configured`** without `ANTHROPIC_API_KEY`, and only for a plan that
   *includes* AI: Starter and Growth get 402 first.
5. `/dashboard/analytics` — cohort retention, CLV, churn, repeat rate, attributed
   revenue.
6. API access and webhooks in `/dashboard/settings`.

**Limitations**

- 25,000 customers, 15 locations, 25 team members, 2,000 AI actions/month.
- No coalition (partner network), SSO, priority support or team management.
- AI returns 503 until `ANTHROPIC_API_KEY` is set.

---

### Business — $99/month · Sevilla Bakery

`business@demo.com`

Four sites, unlimited everything, the full feature set.

| | |
| --- | --- |
| Program | Bakery Rewards — **points**, goal 200, 1 point per €1 |
| Customers | 1,240 (71 VIP, 788 opted into marketing) |
| Locations | 4 (Triana, Centro, Nervión, Los Remedios) |
| Team | owner + admin + 3 managers + 2 staff + viewer |
| Rewards | 7 active, 164 redemptions |
| Campaigns | 6 · Proximity 3 · Automation rules 4 |
| Wallet passes | 50 installed |
| Referrals | 79 |

**Test these**

1. Everything from Pro, plus:
2. `/dashboard/network` — the partner network (coalition offers).
3. Team management with roles across four sites — managers scoped to a location.
4. Unlimited customers, locations, team members, messages and AI actions: the
   billing screen shows `∞` for every cap.
5. The largest dataset in the demo — the right account for judging whether the
   analytics screens hold up.

**Limitations**

- None from the plan. What is unavailable is unavailable to everybody: wallet
  passes need Apple/Google credentials, messaging needs Resend, checkout needs
  Stripe. All three report their own absence.

---

### Trial — 14 days of Pro · Bilbao Pizzeria

`trial@demo.com`

The state **every real merchant is in on day one**, and the only way to see the
trial banner and countdown.

| | |
| --- | --- |
| Stored plan | `trial` · effective plan **`pro`** · 9 days remaining |
| Program | Pizza Points — **points**, goal 150 |
| Customers | 45 · Rewards 6 · Redemptions 31 · Passes 18 |

**Test these**

1. The trial banner: days remaining and a route to checkout.
2. Pro features work — AI, memberships, advanced analytics. A trial is entitled to
   Pro on purpose: the features a merchant falls in love with should be the ones
   worth paying for.
3. `GET /api/v1/billing` reports `stored_plan: "trial"`, `plan: "lapsed"` (the
   billed-tier fallback) and `effective_plan: "pro"`. Read `effective_plan` for
   gating and `stored_plan` to tell "trialling" from "trial ended".
4. `/admin` → Businesses — the row reads **Pro** with a **trial** badge, not
   "Inactive". (It read "Inactive" until this pass, which counted every live trial
   as churn.)

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
4. `/dashboard/billing` shows the reactivation wall and the $5 entry price.
5. The billing screen shows `customers 60 / 0`. That is the state, not a bug: the
   cap of 0 is what refuses a *write*.

---

### Platform admin · `admin@passimo.demo`

Cross-tenant read access. `/admin`.

**Test these**

1. Platform overview — MRR, plan breakdown, workspaces, customers, scans, wallet
   passes. MRR excludes trials.
2. Businesses tab — all six workspaces, each on the tier it is actually using.
3. Impersonate a merchant; the impersonation is written to an audit trail
   (`admin_impersonations`) visible under the Impersonation log tab.
4. Change a plan and watch the merchant's own audit log record that support did it.
5. **Confirm the boundary.** Sign in as any merchant and open `/admin`: the API
   answers 403 and no other tenant's data appears.

---

## Feature matrix (verified, not documented)

Read from `lib/billing/plans.ts` and confirmed against the running API for every
plan. ✅ = the API accepted it. 402 = refused with `payment_required` naming the
tier that includes it.

| Capability | Starter $5 | Growth $19 | Pro $49 | Business $99 | Trial | Lapsed |
| --- | :--: | :--: | :--: | :--: | :--: | :--: |
| Dashboard, customers, CRM (read) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Add / edit customers | ✅ | ✅ | ✅ | ✅ | ✅ | 402 |
| Loyalty program, rewards, redemption | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ scan only |
| QR scanner + manual fallback | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Wallet card designer | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Custom branding | ✅ | ✅ | ✅ | ✅ | ✅ | 402 |
| Wallet proximity | ✅ | ✅ | ✅ | ✅ | ✅ | 402 |
| Basic analytics | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Campaigns | 402 | ✅ | ✅ | ✅ | ✅ | 402 |
| Automations | 402 | ✅ | ✅ | ✅ | ✅ | 402 |
| Segments | 402 | ✅ | ✅ | ✅ | ✅ | 402 |
| Gift cards | 402 | ✅ | ✅ | ✅ | ✅ | 402 |
| Multi-location | 402 | ✅ | ✅ | ✅ | ✅ | 402 |
| Geofencing | 402 | ✅ | ✅ | ✅ | ✅ | 402 |
| Proximity campaigns | 402 | ✅ | ✅ | ✅ | ✅ | 402 |
| Automation rules (no-code) | 402 | ✅ | ✅ | ✅ | ✅ | 402 |
| Memberships | 402 | 402 | ✅ | ✅ | ✅ | 402 |
| AI | 402 | 402 | 503¹ | 503¹ | 503¹ | 402 |
| Advanced analytics | 402 | 402 | ✅ | ✅ | ✅ | 402 |
| API access + webhooks | 402 | 402 | ✅ | ✅ | ✅ | 402 |
| Partner network (coalition) | 402 | 402 | 402 | ✅ | 402 | 402 |
| SSO | 402 | 402 | 402 | ✅ | 402 | 402 |
| Team management | 402 | 402 | 402 | ✅ | 402 | 402 |
| Priority support | 402 | 402 | 402 | ✅ | 402 | 402 |

¹ **503, and only for a plan that includes AI.** The route is fully implemented;
it reports `not_configured` because this deployment has no `ANTHROPIC_API_KEY`.
The order matters and is verified: an anonymous caller gets 401, an unentitled
plan gets 402 naming the tier, and only an entitled merchant on an unconfigured
deployment sees 503.

### Limits

| Limit | Starter | Growth | Pro | Business | Trial | Lapsed |
| --- | --: | --: | --: | --: | --: | --: |
| Customers | 500 | 5,000 | 25,000 | ∞ | 25,000 | 0 |
| Locations | 1 | 5 | 15 | ∞ | 15 | 1 |
| Team members | 2 | 10 | 25 | ∞ | 25 | 1 |
| Messages / month | 500 | 10,000 | 50,000 | ∞ | 50,000 | 0 |
| AI actions / month | 0 | 0 | 2,000 | ∞ | 2,000 | 0 |
| Campaigns / month | 0 | ∞ | ∞ | ∞ | ∞ | 0 |
| Proximity campaigns | 0 | 10 | 50 | ∞ | 50 | 0 |
| Automation rules | 0 | 10 | 50 | ∞ | 50 | 0 |

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
