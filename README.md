# Passimo

Passimo is a customer loyalty and retention platform for physical businesses — cafés,
bakeries, barbers, salons, gyms and boutiques. Customers scan a QR code, their
card lands in Apple or Google Wallet, and the merchant gets CRM, marketing
automation and analytics that work together.

---

## Quick start

```bash
pnpm install
cp .env.example .env.local     # fill in the "Required" block
pnpm db:up                     # PostgreSQL 16 in Docker
pnpm db:migrate                # apply the schema to an empty database
pnpm seed:demo                 # six demo merchants and a platform admin
pnpm dev
```

Or, in one step: `pnpm setup` (database, schema, demo data) then `pnpm dev`.

Nothing here is provider-specific. `DATABASE_URL` can point at the Docker
container, a native PostgreSQL, Railway, Neon, RDS or anything else speaking the
protocol; the schema is applied by `scripts/migrate.ts`, which needs nothing but
`pg`.

Open http://localhost:3000/signup, create a workspace, and you land in a fully
provisioned account: a loyalty program, earning rules, a reward catalogue, ten
saved segments and eight always-on automations.

Or run `pnpm seed:demo` and sign in as `starter@demo.com` / `growth@demo.com` /
`pro@demo.com` / `business@demo.com` — one account per paid plan, each with real
customers, campaigns, geofences and analytics — plus `trial@demo.com` and
`lapsed@demo.com` for the two lifecycle states no paid plan can reach, and
`admin@passimo.demo` for the platform console. The password is `DEMO_PASSWORD`
(default `PassimoDemo2026!`).

Every one of those credentials has been used to sign in against a production
build, and every workspace exercised end to end:
[`DEMO_CREDENTIALS.md`](DEMO_CREDENTIALS.md) has the per-plan test scripts and the
verified feature matrix, [`docs/DEMO_TESTING.md`](docs/DEMO_TESTING.md) is the
hands-on walkthrough, and
[`FUNCTIONAL_VERIFICATION_REPORT.md`](FUNCTIONAL_VERIFICATION_REPORT.md) says what
was executed, what it returned and what is still missing.

### Verifying it yourself

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration
pnpm db:verify              # 15 diagnostic files against the live database
pnpm build && pnpm start &
pnpm verify:functional      # 939 checks over HTTP, every plan
pnpm test:e2e               # 158 browser tests, desktop and mobile
```

### The only variables you need to boot

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | PostgreSQL. The only coupling to a database host in the product |
| `APP_TOKEN_SECRET` | Signs wallet passes, card links, unsubscribe links, file downloads |
| `AUTH_SESSION_SECRET` | Signs session cookies (falls back to `APP_TOKEN_SECRET`) |
| `NEXT_PUBLIC_APP_URL` | Every absolute URL: emails, passes, QR codes, canonical tags |

Everything else is optional. A missing integration is reported as *"not
configured"* in Settings; nothing crashes and no feature silently no-ops.

---

## What it does

**Loyalty engine.** Stamps, points, cashback and paid memberships, with tiers,
configurable earning rules (per visit, per euro, per item, day/time windows,
location, segment, cooldowns, usage limits), milestone rewards, FIFO expiry and
a reward catalogue. Every balance change is an immutable ledger entry.

**Point of sale.** One screen, one hand, two taps: scan the wallet QR (native
camera, no dependency) or search by email/phone/name, then confirm. Idempotent,
so a double tap on café wifi never double-awards.

**Wallet and proximity.** Apple `.pkpass` and Google Wallet objects rendered from
one provider-agnostic description of the card, so the two platforms can never
describe different programs. Live progress, tier, reward, referral code and
offers, plus the full PassKit web service so pushes actually reach the device.

And the reason a wallet pass beats a plastic card: **it comes back**. Unlimited
store locations, each with its own geofence — relevance radius, notification
radius, entry/exit/dwell triggers, opening hours, lock-screen copy, optional
iBeacon. Proximity campaigns with schedules, audiences and personalised copy. A
no-code IF/THEN rule builder that reads its logic back to the merchant as a
sentence. Ten industry strategies applied in one click. A full conversion funnel
with attributed revenue. Everything merchant-configurable; environment variables
hold credentials only. Web geofencing on the customer's card page reaches the
half of customers who never install a pass.
See [`docs/WALLET_PROXIMITY.md`](docs/WALLET_PROXIMITY.md).

**CRM.** Search, saved segments, tags, notes, VIP, duplicate merge, CSV import
(auto-detects competitor exports, carries balances across), export, GDPR
erasure, and per-channel consent with timestamp and source.

**Marketing.** Email, SMS, WhatsApp, push and wallet campaigns; eight always-on
automations (welcome, birthday, win-back, reward-ready, expiry, anniversary,
review request, service recovery); per-recipient delivery log; consent,
suppression, quiet hours and frequency caps enforced centrally.

**Analytics.** Retention, churn, repeat-purchase rate, CLV, average ticket,
cohort retention, campaign ROI with visit attribution, RFM segmentation and an
explainable churn model.

**AI.** Campaign generation from one sentence, daily prioritised insights with
euro impact, natural-language segment building, program optimisation, customer
summaries for staff, feedback theme extraction and copy rewriting.

**Commerce.** Gift cards with an online shop, scheduled delivery and POS
redemption — cash today for something served later. Paid memberships with an
included balance each period, an earn multiplier stacked on top of tier, member
caps and automatic renewal. Both move money only inside a locked, idempotent
database transaction, and both land in the same ledger and reports as
everything else.

**Growth.** Two-sided referrals that pay out only once the referred friend
actually transacts, an advocate leaderboard with attributed revenue, a review
funnel that sends promoters to Google and detractors to the owner, printable
share assets, and a merchant-to-merchant referral programme that pays account
credit.

**The network.** Opt-in local partner directory, two-sided partnerships and
cross-business offers, with per-partnership traffic in both directions. No
customer list is ever shared; directory reach is bucketed, never exact.

**Billing.** Four paid tiers — Starter $5, Growth $19, Pro $49, Business $99 —
defined in one isomorphic catalogue that the pricing page, the paywall and the
API gate all read, so marketing can never promise what the API refuses. No free
plan: a loyalty program that costs nothing never gets set up. A 14-day trial with
everything unlocked, and a `lapsed` state that keeps every row readable while
refusing writes, because nothing is ever deleted. Stripe Checkout and portal,
live usage meters, and a hard/soft limit split that never turns away a customer
standing at the counter.
See [`docs/SUBSCRIPTIONS.md`](docs/SUBSCRIPTIONS.md).

**Platform.** Public REST API with scoped keys, signed outbound webhooks, and
inbound commerce ingestion from Stripe, Square, Shopify, WooCommerce, SumUp,
Zapier and Make — all normalising into one idempotent purchase pipeline. A
platform admin console at `/admin`: every business, MRR, plan changes and
read-only impersonation, each recorded with a mandatory reason in the merchant's
own audit log.

**Two languages, enforced.** Spanish and English, with the locale resolved
server-side from a cookie so the first byte is already correct. Every other
locale is type-checked against the English dictionary, and a test fails the build
if a Spanish value was left in English — so "never mix languages on one page" is a
mechanism, not an intention.
See [`docs/INTERNATIONALIZATION.md`](docs/INTERNATIONALIZATION.md).

---

## Architecture

```
app/
  api/v1/…              REST API. Every route goes through defineRoute().
  dashboard/…           Merchant app (auth-gated by middleware)
  pos/                  Point of sale
  join/[slug]           Public enrolment
  card/[token]          Customer's own card (signed capability link)
  admin/                Platform admin console (platform staff only)
  u/[token]             Unsubscribe
  gift/[slug]           Public gift card shop
lib/
  api/handler.ts        Cross-cutting: validation, auth, rate limit, plan, errors
  auth/                 Actor resolution (session / bearer / API key) + RBAC
  billing/              Plan catalogue, entitlements, Stripe, soft limits
  wallet/               Pass content, provider registry, geo, proximity engine,
                        eligibility, no-code rules, campaigns, analytics
  i18n/                 Dictionaries, translator, locale resolution
  admin/                Cross-tenant reads for the platform console
  loyalty/              Rules engine (pure) + engine (transactional)
  commerce/             Gift cards, memberships
  growth/               Referrals, reputation, coalition
  segments/             Filter DSL, SQL compiler, resolver
  messaging/            Channel providers + the single dispatch gate
  automations/          Trigger → wait → re-check → act
  jobs/                 Outbox queue, worker, handlers
  ai/                   Anthropic client + product capabilities
  integrations/         Normalised commerce ingestion
  db/                   PostgreSQL layer: pool, query builder, introspection
  storage/              Object storage: local disk and S3-compatible drivers
db/migrations/          Schema, functions, seed — applied by scripts/migrate.ts
scripts/
  migrate.ts            Migration runner (ledger, checksums, advisory lock)
  db-reset.ts           Drop and re-apply, to prove a fresh database works
  seed-demo.ts          Deterministic demo environment
```

### Principles

**Nothing slow happens in a request.** Campaign sends, wallet pushes, webhooks,
imports and AI generation are enqueued to a Postgres-backed outbox and drained
by a worker. A 20,000-person campaign is 100 batch jobs, not one timeout.

**Balances only move inside a database transaction.** `passimo_credit_account`
and `passimo_debit_account` take a row lock, honour an idempotency key, and
append to a ledger. Nothing reads a balance into JavaScript and writes it back.

**One gate per concern.** All outbound messages go through `dispatchMessage`,
which is the only place consent, suppression, quiet hours and frequency caps
live. All authorisation goes through `defineRoute` + `requireBusinessAccess`.
All plan entitlement goes through `requireFeature` / `requireWithinLimit`.
Adding a feature cannot accidentally skip a check.

**Role and plan are different questions.** `403` means your role cannot do this;
`402` means your plan cannot, and the response names the cheapest plan that
could. Limits on merchant actions are hard; limits on *their customers'* actions
are soft — nobody is turned away at the till to sell an upgrade.

**Tenant isolation is explicit, in one place, and tested.** Every route resolves
the actor's role on the target business through `requireBusinessAccess` before the
handler body runs, and every tenant-scoped query filters `business_id`. The query
builder refuses an `update` or `delete` with no filter at all. There is no
row-level security policy doing this quietly in the background — that was removed
in migration 000018 along with an explanation, because it was inert on every
deployment this product has had and read as protection that existed.
`tests/integration/tenant-isolation.test.ts` is what stands in its place.

---

## Operations

Two scheduled jobs are required in production:

| Schedule | Endpoint | Purpose |
| --- | --- | --- |
| every minute | `POST /api/v1/jobs/run` | Drain the queue |
| daily 03:00 | `POST /api/v1/cron/daily` | Time-based automations, stats, expiry, membership renewals, scheduled gift cards, AI insights |

Both authenticate with `x-cron-secret: $CRON_SECRET`.

On Railway, add two cron services pointing at the same image, or an external
scheduler calling the endpoints. See [`docs/RAILWAY.md`](docs/RAILWAY.md).

`GET /api/v1/health` is the readiness probe: it returns 503 when PostgreSQL is
unreachable, which is what makes a bad deploy hold rather than take traffic. Add
`?detail=1` with the cron secret for migration state, queue depth and which
integrations are configured.

### Self-hosting

```bash
docker compose --profile app up --build
```

---

## Development

```bash
pnpm verify           # typecheck + lint + unit tests (no database needed)
pnpm verify:full      # the above plus the integration suite
pnpm test:watch
pnpm test:coverage    # enforces 80% on money-affecting modules
pnpm test:integration # real PostgreSQL: query layer, auth, isolation, loyalty
pnpm test:e2e         # Playwright, desktop and mobile viewports
pnpm db:status        # what is applied and what is pending
pnpm db:reset         # drop and re-apply from scratch
```

The unit suite deliberately needs nothing but Node — a suite that needs a
database is a suite people stop running. Everything that genuinely needs one
lives in `tests/integration/`.

CI runs typecheck, lint, unit tests with coverage thresholds, a production build
with **no** secrets and **no** database configured, the integration suite and the
seed against a clean PostgreSQL, `db:reset` to prove a restore works, and
Playwright on both viewports.

---

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the pieces fit and why
- [`docs/WALLET_PROXIMITY.md`](docs/WALLET_PROXIMITY.md) — location-aware passes, geofencing, campaigns, the rule engine, privacy
- [`docs/STORE_EXPERIENCE.md`](docs/STORE_EXPERIENCE.md) — the counter scanner, browser support, offline behaviour
- [`docs/SUBSCRIPTIONS.md`](docs/SUBSCRIPTIONS.md) — the plan catalogue and how feature gating works
- [`docs/INTERNATIONALIZATION.md`](docs/INTERNATIONALIZATION.md) — how "never mix languages" is enforced rather than intended
- [`DEMO_CREDENTIALS.md`](DEMO_CREDENTIALS.md) — sign-in details per plan, a test script for each, the verified feature matrix
- [`docs/DEMO_TESTING.md`](docs/DEMO_TESTING.md) — exercise every feature by hand, in the order a merchant meets them
- [`docs/DATABASE_VERIFICATION.md`](docs/DATABASE_VERIFICATION.md) — the diagnostic query suite, and how to reset, seed and inspect
- [`FUNCTIONAL_VERIFICATION_REPORT.md`](FUNCTIONAL_VERIFICATION_REPORT.md) — what was executed, what was fixed, what remains
- [`docs/DEMO_ENVIRONMENT.md`](docs/DEMO_ENVIRONMENT.md) — `pnpm seed:demo`, the accounts it creates, what they demonstrate
- [`docs/API.md`](docs/API.md) — REST reference, auth, webhooks, errors
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model, GDPR posture
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — deploy, runbook, integrations
- [`docs/INFRASTRUCTURE.md`](docs/INFRASTRUCTURE.md) — what runs where, and the storage decision
- [`docs/POSTGRESQL.md`](docs/POSTGRESQL.md) — the database layer, the query builder, migrations
- [`docs/RAILWAY.md`](docs/RAILWAY.md) — deploying, and connecting passimo.app when it exists
- [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md) — accounts, passwords, sessions, recovery
- [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) — every variable, and what breaks without it
- [`docs/TESTING.md`](docs/TESTING.md) — the four suites and what each is for
- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — symptoms, causes, fixes

Status, honestly assessed: [`PASSIMO_LAUNCH_STATUS.md`](PASSIMO_LAUNCH_STATUS.md).
