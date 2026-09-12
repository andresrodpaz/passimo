# The demo environment

```bash
pnpm seed:demo
```

Four merchant accounts — one per plan — a platform admin, and enough realistic data
that every screen in the product has something on it.

---

## 1. Accounts

Password for all of them: `DEMO_PASSWORD` from `.env.local`, default
`PassimoDemo2026!`.

| Email | Plan | Business | Locations | Customers | Demonstrates |
| --- | --- | --- | --- | --- | --- |
| `starter@demo.com` | Starter $29 | Madrid Coffee | 1 | ~140 | The complete core product on the entry tier: wallet cards, the card designer, campaigns, automations, segments and AI. **No** geofencing, gift cards or multi-location, so the upgrade wall is visible in situ. |
| `growth@demo.com` | Growth $59 | Barcelona Barber | 3 | ~420 | Multi-location, merchant-set geofencing, proximity campaigns, the rule builder, gift cards, advanced analytics. Also the plan the trial runs on. |
| `pro@demo.com` | Pro $99 | Sevilla Bakery | 4 | ~1,240 | Four shops, paid memberships (2 plans, 74 members), the partner network, the largest dataset in the demo. |
| `trial@demo.com` | Trial → Growth | Bilbao Pizzeria | 1 | ~45 | The state every real merchant is in on day one: the countdown banner, and Growth's features without a card. |
| `lapsed@demo.com` | Lapsed | Zaragoza Florist | 1 | ~60 | The reactivation wall. Every read works, every write answers 402, nothing is deleted. |
| `admin@passimo.demo` | — | *(platform staff)* | — | — | `/admin`: every business, MRR, plan changes, impersonation. |

Each account is deliberately a different trade, so a reviewer sees the product working
for a café, a barber, a bakery chain, a pizzeria and a florist rather than five copies
of the same café.

Every workspace sits **inside** its own caps. That is deliberate: a demo account
already over its limit teaches a reviewer that the limits do not hold. `lapsed` is
the exception, and there the "60 / 0" reading is the state working correctly —
zero is what refuses a *write*.

Change the admin list with `PLATFORM_ADMIN_EMAILS` (comma-separated).

---

## 2. What gets created

Per business:

- **Locations** with real city-centre coordinates, per-site geofences, and opening hours
  shaped like that trade's (a bakery gets a split shift; a barber is closed Mondays).
- **A loyalty program** — stamps for the café and barber, points for the gym and bakery —
  with rewards.
- **Customers** on a realistic distribution: a long tail of one-visit customers, a solid
  middle, and a small group of regulars. A uniform distribution would make the retention
  analytics look like nothing any real business has ever seen.
- **Loyalty ledger entries and visits** spread over the last 400 days, so cohort and
  retention charts have a curve.
- **Wallet settings** matching the plan — Starter's `geofencing_enabled` is `false`,
  because a demo showing a Starter merchant using a Growth feature teaches the wrong
  thing about the plans.
- **Proximity campaigns and rules**, active, with funnel counters.
- **Wallet events**: geofence crossings, notifications sent, impressions, clicks, and
  visits that carry `source_event_id` back to their notification — so "average time to
  visit" is populated rather than permanently blank.
- **`wallet_notifications`** including *skipped* ones with reasons, because a merchant
  needs to see why a quiet week was quiet.
- **Apple pass registrations** for ~35% of customers, and Google saves for ~28% — close
  to reality, and the reason "no pass installed" is a normal skip reason rather than an
  error.
- **Team notifications** for the notification bell.
- **RFM segments, churn risk and predicted lifetime value**, computed at the end of
  each business with `passimo_recompute_rfm` and `passimo_recompute_churn_risk` — the
  same functions the daily job runs.

  These are worth calling out because the seed did *not* run them until 2026-09-05, and
  the demo looked broken rather than empty as a result: the built-in "High churn risk"
  segment read 0 on every account, the "VIP" segment lost half its definition
  (*is_vip OR RFM in champion/loyal*), every customer profile showed "—" for churn and
  predicted value, and sorting the customer list by churn did nothing. Running the real
  functions rather than writing plausible numbers is what keeps the seed honest.

  GDPR-erased customers are deliberately skipped — an anonymised person must not carry a
  behavioural profile — so a handful of rows per business have no RFM by design.

---

## 3. Three properties of the script

**It refuses to run against production.** Guarded on `NEXT_PUBLIC_APP_URL`: localhost,
`.local`, `.vercel.app` and `NODE_ENV=development` are allowed, anything else is
refused. A seed script that can write demo customers into a real tenant is a
data-integrity incident waiting for a mistyped environment. Override with
`--i-know-what-i-am-doing` if you genuinely mean it.

**It is idempotent.** Re-running updates the same businesses rather than creating a
fifth Madrid Coffee. Locations match on `external_ref`, campaigns on name, rules on
`template_key`, customers by count. Existing demo users have their password reset to the
documented one, so a stale local database still lets you in.

**It is deterministic.** A seeded PRNG (mulberry32), not `Math.random()`, so two
developers see the same numbers and a screenshot in a bug report matches what the next
person sees.

---

## 4. Why a script and not a SQL seed

It goes through the same database layer and the same `createUser` the application uses,
so a demo account is a real account — you can sign in to it, reset its password and
suspend it. A demo environment you cannot log into is not a demo environment.

Using the product's own code also means the seed exercises the real provisioning path:
it calls `passimo_provision_business`, so if provisioning
breaks, seeding breaks. That is a much better place to find out than a customer's first
signup.

Run through `tsx` with the `react-server` condition, which is what lets the script
import the same `server-only` modules the application uses:

```json
"seed:demo": "tsx --conditions=react-server --env-file-if-exists=.env.local --env-file-if-exists=.env scripts/seed-demo.ts"
```

---

## 5. Setup from scratch

```bash
cp .env.example .env.local
# Fill in DATABASE_URL, APP_TOKEN_SECRET and AUTH_SESSION_SECRET.

pnpm install
pnpm db:up          # PostgreSQL in Docker
pnpm db:migrate     # applies every migration to an empty database
pnpm seed:demo
pnpm dev
```

Then:

| Go to | Sign in as | To see |
| --- | --- | --- |
| `/` | — | The landing page, live demo and pricing |
| `/dashboard` | `growth@demo.com` | Customers, campaigns, analytics with real data |
| `/dashboard/locations` | `pro@demo.com` | Four stores with geofences and split-shift hours |
| `/dashboard/wallet/design` | `growth@demo.com` | The card designer — templates, colours, layout, Apple and Google previews |
| `/dashboard/customers` | `pro@demo.com` | 1,240 customers with real RFM segments, churn scores and predicted value |
| `/dashboard/wallet` | `growth@demo.com` | Brand kit, notifications, campaigns, rules, analytics, templates |
| `/pos` | any merchant | The counter scanner |
| `/admin` | `admin@passimo.demo` | Every business, MRR, impersonation |

---

## 6. Wallet credentials are not required

Everything above works without Apple or Google credentials. The wallet screen reports
which environment variable is missing, previews render from the merchant's real
settings, the campaign preflight returns the literal `pass.json`, and web geofencing on
the customer card page works with no vendor involved.

Only issuing an actual `.pkpass` or Google save link returns 503 `not_configured`.

See `docs/WALLET_PROXIMITY.md` §8.

---

## 7. Resetting

```bash
pnpm db:reset       # drops and re-applies every migration
pnpm seed:demo
```

`db:reset` destroys all local data. There is no undo, and the seed script will not let
you point either command at a non-development host.
