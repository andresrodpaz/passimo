# Passimo — functional verification report

**Date:** 2026-09-02
**Method:** execution, not inspection
**Supersedes:** the verification sections of `PASSIMO_LAUNCH_STATUS.md` (2026-08-28)
and `LAUNCH_AUDIT_REPORT.md` (2026-08-01)

Every figure in this document was produced by a command run against this tree on
this date, against a **production build** (`pnpm build` → `pnpm start`, the
standalone server the deployment runs) and a database **rebuilt from empty**.
Where something was not verified, it says so and names what would verify it.

---

# Executive summary

**The question:** can I log into Passimo as a merchant, use each plan, create
customers, operate the loyalty program, scan customers, award points and stamps,
redeem rewards, configure wallets, run campaigns, and see the resulting analytics?

**Yes — and that answer required fixing eleven defects, three of which made
advertised, paid features do nothing at all.**

The most consequential:

1. **Segmentation matched zero customers, silently.** The SQL compiler emitted
   parameter accessors named `p_params` — the PL/pgSQL *argument* — where the
   executed predicate needs `$1`. `EXECUTE` does no variable substitution, so
   every segment carrying a value failed with `column "p_params" does not exist`,
   and every caller logs-and-returns-0 by design so a broken segment cannot take a
   campaign screen down. Result: the preview read 0 against 331 matching
   customers, "At risk" / "Lost" / "New this month" / "Reward ready" all read 0,
   and **every segmented campaign reached zero recipients.** Segments are a
   Growth-and-up paid feature.
2. **Points and cashback programs were mathematically unreachable.** Provisioning
   creates every workspace with a stamps program earning 1 per visit. Onboarding
   then switches gyms, restaurants, retail and pharmacies to **points** with goals
   of 300–500 — and the handler wrote program columns only. A gym owner finished
   onboarding with a card advertising "500 points for a free PT session" that
   awarded one point per visit. Five hundred visits.
3. **A blocked customer was still credited.** `customers.status = 'blocked'` was
   settable from the dashboard and enforced nowhere: a blocked customer earned on
   every scan, accrued balance, and came back from the earn call with a list of
   claimable rewards. The one control a merchant has against stamp-farming was
   decorative.

Each was invisible by construction: no error, no log line, no failing test. The
first two are now covered by tests that would have caught them, including an
integration suite that runs the TypeScript compiler against the real PL/pgSQL
function — the boundary neither side's tests crossed.

**Position:** the loyalty product works end to end and is verifiable by anybody
who clones the repository. It remains ready for a hand-held pilot cohort rather
than self-service public launch, and the gap is still not code: wallet passes,
outbound messaging and card payments are all credential-dependent and none of
those provider accounts exist.

## Verified in this pass

| Gate | Result |
| --- | --- |
| `pnpm db:reset` — drop schema, replay from empty | **24/24 migrations applied cleanly** |
| `pnpm db:status` | 24 total, 0 pending |
| `pnpm seed:demo` on the rebuilt database | **6 workspaces + platform admin**, 2,765 customers |
| `pnpm db:verify` — 15 diagnostic files, 223 queries | **254 pass, 23 warning, 0 fail, 0 error** |
| `pnpm typecheck` | **Pass**, clean |
| `pnpm lint` | **Pass**, 0 errors, 0 warnings |
| `pnpm test` (unit) | **650 passed**, 26 files |
| `pnpm test:integration` (real PostgreSQL 16) | **82 passed**, 5 files |
| `pnpm build` (production) | **Pass** |
| `pnpm start` (standalone server, as deployed) | **Pass**, static assets served |
| `pnpm verify:functional` (939 HTTP checks) | **939 passed, 0 warnings, 0 failed** |
| `pnpm test:e2e` (Playwright, desktop + Pixel 7) | **158 passed** |

## Not verified in this pass

| Check | Why it matters |
| --- | --- |
| Lighthouse / axe audit | No tooling was run. The accessibility and performance sections below are inspection-based plus what the E2E suite asserts, and say so. |
| Real Apple Wallet pass on a real iPhone | Needs an Apple Developer account and certificates. The builder, web service, registration and update endpoints are implemented and unit-tested; no pass has been installed on a device. |
| Real Google Wallet pass | Same, for an issuer account. |
| A real email, SMS or WhatsApp delivery | Needs Resend. Composition, segmentation, scheduling, suppression and templating are exercised; nothing has been delivered to an inbox. |
| A real Stripe checkout, upgrade, downgrade or dunning cycle | Needs Stripe keys and price ids. The flows are implemented and the webhook is idempotent and signature-verified; no card has been charged. |
| Camera QR scanning on physical devices | Playwright has no camera. The manual fallback is verified on both viewports; the camera path is inspection-only. |
| Load or soak testing | No tooling was run. Query plans and index coverage were reviewed statically. |

---

# Environment tested

| | |
| --- | --- |
| Platform | Windows 11, Node 22.17.0, pnpm 10.16.1 |
| Database | PostgreSQL 16.14 (Docker, `postgres:16-alpine`), port 5433 |
| Application | Next.js 16.2.4, production build, standalone server |
| Base URL | `http://localhost:3000` |
| Credentials configured | none — Stripe, Resend, Anthropic, Apple, Google, Maps all absent |
| Storage | local disk driver (`STORAGE_DRIVER=local`) |

Running with no provider credentials is deliberate: it is the configuration a
reviewer clones into, and it is the configuration in which "does the product
report its own limits honestly?" is answerable.

---

# Database status

**Launch ready. 98%.**

| Check | Result |
| --- | --- |
| Tables | 65 |
| Functions (`passimo_*`) | 59 |
| Indexes | 155+ |
| Foreign keys | 169 |
| Tenant-scoped tables (`business_id`) | 58 — all with a foreign key, all `on delete cascade` |
| Rows after seed | 2,765 customers · 16,823 ledger entries · 16,823 activity events · 592 redemptions |
| Size | 44 MB |

## What the 15 diagnostic files establish

Created in this pass at [`scripts/db/`](scripts/db), with a runner
(`pnpm db:verify`) that turns the `status` column into an exit code.

- **Balance equals the sum of the ledger** for every account. Zero mismatches.
  This is the invariant a wallet card's number rests on.
- `lifetime_earned` equals the sum of credits. Zero mismatches.
- `balance_after` matches a recomputed running total for all 16,823 entries. This
  caught a seed defect where 1,103 entries shared timestamps, making a customer's
  own history read as though their balance went down and back up.
- No negative balances. No entry whose sign contradicts its type. No zero-amount
  entries.
- Idempotency keys unique per workspace, with a unique index behind them.
- Ledger, `reward_redemptions` and `activity_events` all agree about every
  redemption — three records of one event, reconciled in both directions.
- `rewards.redeemed_count` matches the redemption table. Zero drift.
- `customers.notes_count` matches the notes table. Zero drift.
- Derived customer stats (`visit_count`, `lifetime_spend`, `average_ticket`)
  match the events they are computed from, for all 2,765 customers.
- Analytics functions agree with an independent recount, per workspace.
- Zero orphan rows across 22 relationships.
- Zero duplicated natural keys across 14 uniqueness rules.
- Every unique constraint that must exist, does.
- Every index the product's list screens need, exists.

## Issues found and fixed

| Issue | Fix |
| --- | --- |
| **Seven tenant tables had a nullable `business_id`.** A row written without a tenant is invisible to `where business_id = $1` and present in `count(*)` — a customer nobody owns, in the platform total, unfindable by the merchant, unreachable by a cascade. Nothing prevented one. | Migration **`000022`**. `customers`, `campaigns`, `team_members`, `reward_redemptions`, `gift_cards`, `stamp_events`, `nps_responses` are now NOT NULL. Four columns are deliberately left nullable — `jobs`, `audit_log`, `subscription_events` hold platform-scoped rows, and a null `message_templates.business_id` *is* the built-in template — and the migration names each. It refuses to run if any target holds a null, rather than failing halfway. |
| **No workspace could be deleted at all.** Every tenant key is `on delete cascade`; the cascade reaches `loyalty_ledger`; `trg_ledger_guard` refuses every DELETE on that table. So `delete from businesses` failed for any workspace that had ever recorded a stamp — which is all of them. Account closure was impossible, and every integration fixture leaked (their teardown swallowed the error). | Migration **`000023`**. The guard now honours one session-scoped permission, set with `set local` so it cannot survive the transaction, and `passimo_delete_business(uuid)` is the only thing that sets it. A bare `delete from loyalty_ledger` is still refused — the migration's own verification block proves both halves. `dropTenant` in the fixtures now uses it and throws on failure. |

## Remaining, unfixed

- **RLS is off on all 58 tenant tables.** Deliberate — migration `000018` explains
  why at length, and the reasoning holds: the application connects as the schema
  owner, a table owner bypasses its own policies unless FORCEd, and the removed
  policies were evaluated for zero queries while reading as protection that
  existed. Isolation is enforced in `lib/auth/context.ts` plus an explicit filter
  on every query, and this pass verified that empirically (450 cross-tenant probes,
  ~50 data-shape checks, all clean). It remains a defence-in-depth gap for a future
  least-privilege role or a BI tool connecting directly.
- **`passimo_platform_overview`'s `mrr_cents` column counts trialling workspaces
  as revenue.** The TypeScript layer recomputes MRR itself and excludes them, so
  nothing reads the wrong number — but the column is dead and misleading, and
  fixing it needs a migration.
- **23 warnings from `pnpm db:verify`**, all expected and all documented in
  `docs/DATABASE_VERIFICATION.md#known-warnings`: 15 unused indexes on a database
  that has served no traffic, 4 tenant tables where the primary key *is* the tenant
  index, the RLS note, 4 paid-tier-without-Stripe rows (correct for a demo), and 2
  rewards priced above any balance ever held (pricing decisions, not defects).

---

# Migration status

**Launch ready. 100%.**

24 migrations, `000000` to `000023`. `pnpm db:reset` drops `public` and replays
all 24 from nothing — run three times in this pass, clean every time.

The runner records a SHA-256 per file and refuses to run when an applied
migration's contents change. That is why migrations `000001`–`000017` still
contain `fidelio_*` identifiers: editing them, even a comment, breaks
`pnpm db:migrate` on every deployed database. `000017` renames every routine to
`passimo_*` and asserts none remain — verified: zero `fidelio%` routines exist.

Both new migrations verify themselves. `000022` counts untenanted rows and raises
with the table names before altering anything. `000023` creates a throwaway
tenant, proves a direct ledger delete is still refused, proves
`passimo_delete_business` succeeds, and proves the cascade reached the ledger.

---

# Demo accounts

**Launch ready. 100%.** Full details in [`DEMO_CREDENTIALS.md`](DEMO_CREDENTIALS.md).

Six workspaces: one per purchasable plan, plus the two lifecycle states no paid
plan can reach. Every credential was used to sign in against the production build
in this pass.

| Plan | Business | Customers | Locs | Team | Rewards | Redemptions | Campaigns | Proximity | Passes | Referrals |
| --- | --- | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| Starter $5 | Madrid Coffee | 140 | 1 | 2 | 6 | 47 | 5 | — | — | 8 |
| Growth $19 | Barcelona Barber | 420 | 3 | 4 | 6 | 92 | 6 | 2 + 3 rules | 84 | 31 |
| Pro $49 | Valencia Fitness | 860 | 3 | 6 | 7 | 207 | 6 | 3 + 4 rules | 46 | 61 |
| Business $99 | Sevilla Bakery | 1,240 | 4 | 8 | 7 | 164 | 6 | 3 + 4 rules | 50 | 79 |
| Trial (→ Pro) | Bilbao Pizzeria | 45 | 1 | 2 | 6 | 31 | 6 | 2 + 3 rules | 18 | 1 |
| Lapsed | Zaragoza Florist | 60 | 1 | 1 | 6 | 51 | 5 | — | 21 | 1 |

## Demo-data defects found and fixed

The demo was not merely thin in places — it was **internally contradictory**, in
ways that made working features look broken.

| Defect | What a reviewer saw | Fix |
| --- | --- | --- |
| **Zero `reward_redemptions` rows** while the ledger held 337 `redeem` entries. | Analytics reporting "6,200 points redeemed" beside "0 redemptions" on the same panel. Every reward captioned "nobody has ever claimed this". Empty redemption history on customers whose balance had visibly been spent. | The seed writes the redemption record, the `activity_events` row the analytics function counts, `lifetime_redeemed` and `rewards_earned` on the account, and syncs `rewards.redeemed_count`. Ledger, redemptions and analytics now agree: 592 = 592. |
| **Zero customers with marketing consent.** | Every campaign send reached 0 recipients. The builder, the segments and the channel previews all worked; the only number a merchant would check afterwards was always 0, which reads as a broken product. | ~64% now consent, with a timestamp (consent without a record of when it was given cannot be defended if challenged). |
| **Zero referrals.** | The Growth screen, the referral leaderboard and the `referral` earning rule all rendered as zeroes on every plan. | 1-in-12 members arrive through a friend's code, in all three states — pending, qualified, rewarded. |
| **Valencia Fitness had zero redemptions.** Goal 500, awards scaled wrong. | The **Pro** demo — the account a reviewer opens to see AI, cohort retention and memberships — had the deadest data of the four. | Per-trade ticket ranges, and points earned = euros spent, matching the live rule exactly. All six workspaces now have redemptions. |
| **No `wallet_card_designs` row for any workspace.** | Six businesses in six trades, all shipping the same grey default card. The card designer — one of the two screens a merchant is buying — opened empty on every account, so "does customisation persist?" could not be answered by looking. | The seed writes the design, spreading the four card styles across the plans so a reviewer can see the choice does something. |
| **The seed wrote `wallet_settings.brand_color`**, a column migration `000021` had retired. | A colour recorded where nothing reads it, beside no design row at all — reintroducing the second source of truth the migration removed. | Removed. `011_wallet.sql` flags it if it comes back. |
| **One team member per workspace** (the owner). | RBAC untestable from the demo: nobody who was not an owner, so no way to see what a `staff` role cannot do. | Per-plan rosters sized inside each plan's cap — 1 colleague on Starter (cap 2), 7 on Business. Managers scoped to a site. `invited`, not `active`, so no extra passwords to document. |
| **No trial and no lapsed workspace.** | The trial banner and the reactivation wall could not be opened at all — and the paywall is what decides whether the product can charge. | Bilbao Pizzeria (9 days of Pro left) and Zaragoza Florist (cancelled 21 days ago). |
| **1,103 ledger entries with duplicate timestamps.** | A customer's own history sorted arbitrarily, so `balance_after` disagreed with a running total and the profile read as though their balance went down and back up. | Each entry offset by its index; a redemption lands two minutes after the earn that funded it, which is also how it happens at a counter. |
| **Test residue accumulating in the demo.** | "qb mtisa38e1" and "loyalty mtisa1bi1" sitting between Madrid Coffee and Sevilla Bakery in the platform admin console. | `pnpm seed:demo` clears it first, matched on identifiers only the fixtures own (`zz-verify-*`, `@passimo.test`, `.invalid` — an RFC 2606 reserved TLD a real customer cannot hold). |

## Customer-state coverage

Every state the dashboard has distinct UI for is present in every workspace, so no
screen renders as an empty state. Verified by `scripts/db/006_customers.sql`:

| Workspace | Active 30d | VIP | Churn risk 90d+ | Reward ready | New 30d | Has redeemed | Referral |
| --- | --: | --: | --: | --: | --: | --: | --: |
| Madrid Coffee | 81 | 13 | 40 | 7 | 6 | 31 | 8 |
| Barcelona Barber | 227 | 40 | 105 | 19 | 17 | 52 | 31 |
| Valencia Fitness | 490 | 51 | 204 | 34 | 35 | 143 | 61 |
| Sevilla Bakery | 680 | 71 | 333 | 9 | 48 | 155 | 79 |

---

# Plan verification

**Launch ready. 100%.**

Four purchasable tiers, entry price **$5**, **no free plan**. Verified against the
running API for all six workspaces:

- `GET /api/v1/billing` lists exactly four purchasable tiers: $5, $19, $49, $99.
- The cheapest is $5. No tier is priced below it.
- `trial` and `lapsed` never appear as purchasable.
- Every workspace's stored plan, effective plan, feature set and eight limits
  match `lib/billing/plans.ts` exactly.
- A new signup lands on `plan = 'trial'` with `trial_ends_at` 14 days out and
  `effective_plan = 'pro'` — never a free plan.
- A live trial resolves to Pro; an expired one to lapsed.

## Issues found and fixed

| Issue | Fix |
| --- | --- |
| **Starter declared limits it could never consume.** `campaigns_per_month: 2` and `proximity_campaigns: 1` on a plan whose *features* include neither, so the quota was refused with 402 long before the counter was read. The billing screen renders a meter per limit key, so a Starter merchant saw "Campaigns 0 / 2" beside a Campaigns button answering "available from Growth" — two screens, two answers, and the wrong one was the more encouraging. | Both set to 0. `lowestPlanWithLimit('campaigns_per_month', 1)` now correctly returns Growth. |
| **`Entitlements.plan` was documented as "straight from the `businesses` row" and was not.** `normalizePlanId('trial')` returns null — `trial` is a lifecycle state, not a tier — so the field became `lapsed` for a live trial. Read on its own it says a trialling workspace has no subscription. | Docstring corrected to describe what it is; `storedPlan` added alongside it and exposed as `stored_plan` in the billing response, so a client can tell "trialling" from "trial ended" without inferring it. |
| **The admin console labelled every live trial "Inactive."** Three call sites wrote `normalizePlanId(row.plan) ?? 'lapsed'`. So the plan breakdown counted live trials as churn — the metric a founder reads first — the workspace list showed "Inactive" in the same row as a future `trial_ends_at`, and the business drawer overwrote the stored `plan` with `lapsed` on the way out. | `describeStoredPlan` added to `lib/billing/entitlements.ts`, deriving from the one function that already resolved this correctly. The console now shows the tier a trial is evaluating with a separate **trial** badge, MRR still excludes it, and the drawer reports the stored value *and* the resolved one instead of overwriting. |

---

# Authentication

**Launch ready. 96%.**

Verified over HTTP against the production build:

- Sign-in for all 6 merchant accounts plus the platform admin. Session cookie
  issued, `httpOnly`, `SameSite=Lax`, `secure` in production.
- The workspace list rides along on the sign-in response, so the client routes
  straight to the dashboard or to onboarding without a second round trip.
- 8 protected endpoints refuse an anonymous caller with 401.
- `GET /dashboard` without a session redirects to `/login`, preserving the
  intended destination.
- A wrong password and an unknown account are **indistinguishable** — same status,
  same message. No user enumeration.
- Five wrong passwords locks the account for 15 minutes. Per *account*, so it
  holds however many addresses an attacker rotates through; the per-IP bucket is
  looser on purpose, because one shop is one IP and a fumbled password must not
  lock out a colleague.
- Password hashes: 100% scrypt, six segments, correct encoding. No unsalted
  MD5/SHA shapes.
- Sessions stored as SHA-256 hashes — a leaked `user_sessions` dump is not a set
  of live cookies.
- Sign-out invalidates the session server-side; the next request is 401.
- Signup validates password strength server-side (length *and* guessability), not
  just in the browser.

**Remaining:** no MFA. OAuth is not implemented (email + password only). Both are
deliberate scope choices for a counter product where staff share a tablet, and
both are things a franchise buyer will ask about.

---

# Authorization

**Launch ready. 98%.**

Five roles (`owner`, `admin`, `manager`, `staff`, `viewer`) with an explicit
permission list, resolved per request in `lib/auth/context.ts`.

Verified:

- Route options declare `permissions`, checked after the tenant is resolved and
  before the handler runs.
- 403 (role) and 402 (plan) are distinct, and the ordering is enforced: role
  first, then plan. A viewer on Pro is told about their role; an owner on Starter
  is told about their plan. Conflating them is how merchants email support instead
  of upgrading.
- A merchant cannot read the admin overview or list workspaces: 403.
- Cron endpoints refuse a caller without the shared secret.
- The scan endpoint splits its checks: identifying a customer needs
  `customers:read`, crediting one needs `loyalty:earn`, so a viewer can still look
  somebody up.

## Issue found and fixed

**The deployment-capability check ran before authentication.** `defineRoute`
evaluated `options.requires` as its first step, so:

- An unauthenticated stranger could POST to `/api/v1/ai` or the Stripe checkout
  routes and learn from the 503 whether this deployment holds an Anthropic or
  Stripe key. That is deployment inventory handed to anybody.
- Worse for the product: a **Starter merchant** who clicked an AI button was told
  "AI features is not configured on this deployment" — so the one refusal that
  should have sold them an upgrade told them the product was broken.
- And the plan gate for those routes never ran at all, so it was untestable.

Moved to step 7, after the plan entitlement. Verified: anonymous → **401**,
unentitled plan → **402** naming the tier, entitled plan on an unconfigured
deployment → **503**. Which is the only audience for whom that sentence is true.

---

# Tenant isolation

**Launch ready. 100%.** The most thoroughly verified area in this pass.

## From the API

`pnpm verify:functional`, across every ordered pair of the six workspaces:

- **300 cross-tenant read probes** — customers, analytics, rewards, campaigns,
  locations, wallet design, wallet settings, onboarding, billing, business detail.
  **0 leaks.** Every one answered 403 or 404.
- **150 cross-tenant write probes** — customer creation, loyalty earn, wallet
  design update, business update, brand update. **0 leaks.**
- The harder shape: a *customer id* belonging to another tenant, presented with
  the caller's **own** business id — which is what defeats a naive
  `where id = ?`. 404.
- Awarding points to that customer: refused.

## From the data

`scripts/db/014_tenant_isolation.sql`:

- All 57 expected tenant tables carry `business_id`.
- All 58 `business_id` columns have a foreign key. All 58 are `on delete cascade`.
- No tenant table has an unexpectedly nullable `business_id` (migration `000022`).
- **~50 relationship checks for the shape a leak leaves behind** — a row whose
  `business_id` disagrees with something it points at — across the ledger,
  accounts, redemptions, rewards, rules, tiers, events, notes, tags, campaigns,
  automations, messages, wallet registrations and events, proximity campaigns and
  their locations, referrals, team members, gift cards, memberships, surveys and
  webhooks. **0 violations.**
- Natural keys are scoped per tenant. Two are deliberately global —
  `customers.referral_code` and `gift_cards.code`, both generated random codes
  typed by someone who does not know which business issued them — and both are
  named as such rather than silently excluded.
- No policy left behind claiming to isolate tenants. No table has FORCE RLS.
- No API key or webhook endpoint without a workspace.
- No user with access to more than one workspace in the demo.

## From the browser

`tests/e2e/demo-plans.spec.ts`, added in this pass: a merchant opening `/admin`
sees no other tenant's data.

---

# Onboarding

**Launch ready. 95%.**

Four steps, two skippable, defined once in `app/onboarding/page.tsx` so the
stepper, the skip control, the progress percentage and the resume logic cannot
disagree.

Verified end to end on a brand-new account:

- Signup → workspace provisioned → onboarding reachable.
- Program created, reward configured, location added, branding set, wallet card
  configured, business marked complete.
- **Resume across a full session boundary.** Progress captured mid-flow, signed
  out (session invalidated, 401 confirmed), signed back in — onboarding state
  byte-identical. Progress lives in `business_onboarding.last_step`, not in React
  state.
- First customer registered, first stamp awarded, and the visit appearing in
  analytics on a workspace that was empty a minute earlier.
- A brand-new workspace renders analytics without dividing by zero — retention
  100%, one customer, no NaN.
- `/join/<slug>` for the new business works, and the public business endpoint
  serves it.

E2E covers the same path in a browser on both viewports: "a new merchant reaches
the counter through four steps, two skippable", and "the first scan works from
the counter, with no camera".

## Issue found and fixed

**Onboarding produced an unreachable loyalty program for half the trades.**
Detailed under [Loyalty](#loyalty) — it is the same defect, and onboarding is
where a merchant meets it.

**Remaining 5%:** email verification is implemented but cannot be exercised
without Resend, so the demo marks accounts verified. The one-minute-rule claim
("account to first scan in under ten minutes") is plausible from the step count
and was not stopwatch-timed.

---

# Loyalty

**Launch ready. 97%.**

Verified per workspace, on both program types:

- A default program exists, with active earning rules for visits and purchases.
- Customer creation, and a duplicate email resolving to the **same** customer
  rather than a second row.
- Lookup by email, search by name, and every sort the CRM offers.
- Award for a visit and for a purchase; balance, `visit_count`, `lifetime_spend`
  and the progress ring all move.
- **Idempotency:** replaying an earn with the same key returns
  `duplicate: true` and the balance does **not** move again.
- The ledger carries a `balance_after` and a human reason per line; the activity
  feed carries the visit.
- Manual adjustment moves the balance by exactly the amount given, and records the
  reason.
- Analytics reflect the new visit within the same request cycle.

## Issues found and fixed

### 1 · Points and cashback programs could not reach their own goal

`passimo_provision_business` creates every workspace with a **stamps** program and
one rule: `visit → fixed → 1`. `lib/onboarding/presets.ts` classifies gyms,
restaurants, retail and pharmacies as **points** programs with goals of 300–500.
The wizard PATCHes `/api/v1/programs` with the new type and goal, and that handler
wrote program columns only.

So a gym owner finished onboarding with a card advertising "500 points for a free
personal training session" that awarded one point per visit. **Not slow —
unreachable.** And invisible from the dashboard: the program screen showed goal
500, the rules screen showed a rule that awards 1, and nothing on either screen
relates those two numbers.

`POST /api/v1/programs` was worse: it created a program with **no rules at all**,
so a merchant adding a second program got one that credited nothing on every scan.

**Fix:** `lib/loyalty/default-rules.ts` derives the rules from the type, and both
the create and the type-change paths call it. A points program gets
`purchase → per_currency → 1 per 1` (one point per unit of currency, the
convention every customer already understands) plus a `visit → fixed → 1` floor so
a counter check-in with no amount still credits something. Cashback gets
`purchase → percent`. Only the *untouched provisioned* rule is rewritten — never
one a merchant has edited or that has ever fired — and the name follows too, so a
gym's rules screen no longer reads "Stamp per visit".

**Verified:** a €42.50 purchase on Valencia Fitness (points, goal 500) now credits
**42 points**. On Madrid Coffee (stamps, goal 8) it credits **1 stamp**. Both
correct.

### 2 · A blocked customer was still credited

`customers.status` accepts `blocked`, the dashboard offers the switch, and nothing
enforced it. A blocked customer earned on every scan, accrued balance, and came
back from the earn call with a list of claimable rewards. The one control a
merchant has against somebody farming stamps — sharing a card, scanning a
screenshot at two branches — was decorative, and the abuse continued while the
merchant believed they had stopped it.

**Fix:** `recordEarn` and `redeemReward` both refuse a blocked customer before the
rules are evaluated — afterwards would still burn a rule's `usage_count` and
cooldown — with a machine-readable `reason` the browser translates. Anonymised
customers are refused in the same breath: writing a ledger row against a customer
who exercised their right to erasure re-creates the link the erasure removed.

**Verified:** blocked → 422 `customer_blocked` on both earn and redeem; unblocking
restores awarding.

**Remaining 3%:** cashback and membership program types are implemented and
unit-tested but no demo workspace uses them, so neither is exercised end to end.
Tier progression is implemented; no demo program enables tiers.

---

# Rewards

**Launch ready. 98%.**

Verified per workspace:

- Catalogue readable; every demo merchant has 6–7 active rewards and a redemption
  history.
- Reward creation with cost, validity, per-customer limit, stock and minimum tier.
- Eligibility computed per customer, with an `affordable` flag that is correct for
  both a zero-cost reward and an unreachable one.
- Redemption creates a record with a code staff can read aloud, debits exactly the
  cost, and appears in the customer's history.
- **A per-customer usage limit blocks a second redemption**, with a translatable
  reason.
- **Replaying a redemption with the same idempotency key** creates no second
  redemption.
- **Redeeming what the customer cannot afford** is refused, naming insufficient
  balance.
- Redeeming a non-existent reward: 404.
- An unknown granted-reward code: refused with `grant_not_found`.
- Analytics redemption count rises, and the reward stops being flagged "never
  claimed".

Auto-granted rewards (welcome, birthday, win-back) exist in every workspace, and
`008_rewards.sql` verifies every `grant_reward` automation action points at a
reward that exists.

**Remaining 2%:** reward *images* are supported by the schema and unused by the
demo. Expiry sweeping is implemented as a scheduled job; the cron has not been run
against a database with expired grants.

---

# QR scanner

**Launch ready. 92%.**

## Verified

Six payload formats, all resolving to the right customer:

| Format | Result |
| --- | --- |
| `card.<body>.<signature>` — bare signed token | ✅ |
| `https://<host>/card/<token>` — the link in every email and pass | ✅ |
| `passimo:card/<token>` | ✅ |
| `psm:card/<token>` | ✅ |
| `fidelio:card/<token>` — pre-rename, still in customers' phones | ✅ |
| `passimo:card.<body>.<signature>` — concatenated | ✅ *(fixed in this pass)* |

Manual fallbacks — the supported path when there is no camera: identify by email,
by customer id, and the counter roster for tap-to-serve. All verified.

Edge cases:

- **An unknown code answers 200** with `resolution.kind = 'unknown'` and a hint a
  cashier can read, and credits nothing. That is the right contract, not an
  oversight: at a counter the camera reads a bottle's barcode as often as a pass,
  and a 404 toast on every stray scan trains staff to ignore the screen.
- A well-formed but unknown token does not resolve to a customer.
- A forged token does not resolve.
- An empty payload and an oversized one both fail validation.
- Check-in **without** an idempotency key is refused — it is what makes an offline
  replay safe.
- A **duplicate scan** with the same key does not double-credit.
- A scan captured **offline** and replayed later succeeds, with its original
  timestamp.
- A **blocked** customer is refused.

## Issue found and fixed

`passimo:card.<body>.<signature>` — the form a generator produces when it
concatenates the scheme with a token that already begins `card.` — matched `card`
as a *target selector* and left the token as `.<body>.<signature>`, a leading dot
that resolves to nobody. The counter answered "no member matches" for a payload
following the documented scheme exactly. That is the worst shape of scanner bug:
the QR is right, the parser is wrong, and the cashier blames the customer's card.

**Fix:** the scheme is stripped first and the remainder classified separately, with
the signed-token shape checked before `card` is read as a selector. Regression
test added.

## Not verified

**Camera scanning on physical devices.** Playwright has no camera, so the browser
scanner path is inspection-only. The implementation uses `jsqr` against a
`MediaStream`, with torch, camera switching, continuous scanning and an audible
confirmation; the CSP permits `media-src 'self' blob:` and the Permissions-Policy
allows `camera=(self)`. E2E verifies the manual panel on both viewports and that
the landing page does **not** open a camera — checked explicitly.

Devices that need a physical test: iPhone Safari, Android Chrome, iPad, Android
tablet, laptop webcam.

---

# Wallet

**Architecture launch ready. 95%. Provider activation: credential required.**

## Implemented and verified

- `GET /api/v1/wallet/design` returns the resolved design, the resolved brand kit,
  the program's own vocabulary and provider readiness — everything the designer
  renders — through `resolveCardDesign`, the same function the pass builder calls.
  **It is not a mock.**
- Ten trade templates; a template applies in one action and changes the stored
  design.
- Both providers report `configured` honestly, and an unconfigured one **names the
  exact environment variables it needs**. Verified: Apple reports 4 missing
  variables, Google reports its own.
- Pass update architecture: `wallet_sync_state`, the Apple web service under
  `/api/v1/wallet/apple/v1/[...path]`, registration and push token storage, and a
  sync queue. Unit-tested end to end.
- Location configuration with per-site geofence radii, entry / exit / dwell
  triggers, dwell minutes and beacon fields.
- Proximity campaigns with schedule, weekdays, time window, segment, minimum
  tier / points / visits, VIP-only and per-customer send caps.
- The no-code automation-rule builder (IF/THEN), 4 rules seeded on Pro and
  Business.
- Notification personalisation: title, message, emoji, CTA, expiry, quiet hours,
  daily caps, minimum gap.
- The wallet event funnel: impressions, opens, clicks, visits, redemptions,
  attributed revenue.

## Credential required

| Provider | Missing | Consequence |
| --- | --- | --- |
| Apple Wallet | `APPLE_TEAM_ID`, `APPLE_PASS_TYPE_IDENTIFIER`, WWDR certificate, signer certificate and key | No `.pkpass` can be signed or installed |
| Google Wallet | `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON` | No pass object can be created |
| Geocoding | `GOOGLE_MAPS_API_KEY` | Addresses must be geocoded by hand; the demo ships real coordinates |

The product does not pretend otherwise: the wallet buttons and the pass endpoints
report their own absence, and the design panel names the variables. **No pass has
been installed on a real device in this pass.**

## Not available

- **Per-location card variants.** `wallet_card_designs` is keyed on `business_id`.
  A deliberate scope choice.
- **`coverUrl`** is stored and editable and renders nowhere — the one remaining
  half-wired brand field.

---

# Wallet customization

**Launch ready. 98%.**

Verified per workspace, with a save-and-re-read on every field:

- Template, card style (solid / gradient / duotone / frosted), progress rendering
  (auto / bar / stamps / points / none), typography (system / rounded / serif /
  mono).
- Background, foreground and accent colours. Persisted exactly, normalised to
  lower case — one canonical form, so a contrast check cannot disagree with
  itself.
- Six visibility toggles, headline, custom message, terms text. Every one
  persisted across a re-read.
- Logo and banner upload. The upload ceiling and the embed ceiling are **one
  number** (`MAX_PASS_IMAGE_BYTES`, 512 KB), shared by the route, the client
  pre-check and the pass builder — so a file that cannot reach the card is refused
  at the file picker in the merchant's own language rather than never.
- An invalid colour (`chartreuse`) is rejected with 422 rather than stored.
- An unknown card style is rejected.

## Issue found and fixed

**No demo workspace had a card design row**, so the designer opened empty on every
account and the `template` chosen for each of the six businesses reached nothing.
Six trades, one grey card. Fixed in the seed, with the four card styles spread
across the plans so the choice is visibly load-bearing.

---

# Brand kit

**Launch ready. 97%.**

One record of business identity on the `businesses` row: name, description, logo,
icon, cover, four colours, font, seven contact fields, three social handles.
Migration `000021` made it authoritative and removed the competing source.

Verified in this pass: changing the primary colour and confirming it reaches the
**server-rendered** join page — in the first byte, not after a client fetch.

Consumers, all reading one resolver:

| Consumer | Path |
| --- | --- |
| Wallet pass (both providers) | `mapBrandKit` → `resolveCardDesign` |
| Public join page | `resolveBrandPalette` (now server-rendered) |
| Browser card page | `resolveBrandPalette` |
| Public gift shop | `resolveBrandPalette` |
| Outbound email shell | `emailBrandFromRow` → `mapBrandKit` |
| `LoyaltyCard` component | `meetsContrastAA` + `readableTextOn` |

**Luminance is implemented exactly once**, enforced structurally: a test reads the
source tree and asserts the WCAG coefficients appear in `card-design.ts` and
nowhere else. Three copies once disagreed, so one brand colour produced white text
on the installed pass and dark text on the join page advertising it. No unit test
on any single copy could catch that; only the count can. *(That test was timing
out under load at 5 s — it walks several hundred files — and a structural check
that fails intermittently gets muted. Given an explicit 30 s budget in this pass.)*

**Remaining 3%:** campaigns and automations compose their own copy and do not read
brand imagery. `coverUrl` renders nowhere.

---

# CRM

**Launch ready. 95%.**

Verified: customer creation, duplicate handling, lookup by email, search by name,
four sorts (recent, spend, churn, balance), the VIP filter, notes, VIP marking,
CSV export, blocking and unblocking, and GDPR erasure via anonymisation
(`DELETE /api/v1/customers/{id}` calls `passimo_anonymize_customer` — personal
data goes, the ledger stays, which is what art. 17(3) allows).

Tags, segments, import with column mapping and duplicate resolution, customer
merging, and RFM / churn / CLV scoring are implemented; the demo exercises tags,
segments and scoring, and `006_customers.sql` confirms all 2,765 customers are
scored.

**Remaining 5%:** CSV import was verified by unit test and by reading the route,
not by driving the UI end to end — `bulk` is five an hour, which made repeated
manual runs impractical inside this pass. Customer merging is implemented
(`passimo_merge_customers`) and untested here.

---

# Marketing and campaigns

**Composition launch ready. 90%. Delivery: credential required.**

Verified per entitled workspace:

- Four campaign kinds created and read back: **welcome**, **reward reminder**,
  **win-back**, **VIP promo**.
- A campaign with no name and no channel is refused with 422.
- Scheduling persists, reads back as `scheduled`, and can be reverted to draft.
- Created campaigns appear in the list.
- **Send answers honestly.** Without `RESEND_API_KEY` it reports the missing
  provider rather than reporting success. That is the check that matters: a
  product that fakes a send will fake it in front of a merchant.
- `010_campaigns.sql` verifies no campaign declares a channel it has no copy for,
  no counter is impossible (`delivered + failed ≤ sent`, `opened ≤ delivered`), no
  scheduled campaign is overdue, and every workspace with campaigns has a
  reachable audience.

Automations: 9–10 per workspace, three active (welcome, birthday, win-back), each
with a trigger, delay, optional segment, actions and a cooldown. No active
automation has zero actions or points at a missing segment.

## Issue found and fixed

**Segmentation matched nobody.** The headline defect of this pass; see
[Segmentation](#segmentation) below. Since campaign audiences are segments, this
meant **every segmented campaign reached zero recipients** — and the demo had no
consenting customers either, so the reach was doubly zero.

**Credential required:** Resend for email. SMS and WhatsApp are implemented behind
the same `dispatchMessage` gate and need their own providers.

---

# Segmentation

**Launch ready. 95%.** *Was 0% functional before this pass.*

## The defect

`lib/segments/compile.ts` emitted parameter accessors named `p_params` — after the
PL/pgSQL **argument** the four `passimo_segment_*` functions take. Those functions
bind it with `EXECUTE ... USING p_params`, which makes it **`$1`**. `EXECUTE`
performs no variable substitution on the query text, so the SQL engine saw an
unknown column:

```
column "p_params" does not exist
```

`resolveSegmentDefinition`'s callers log and return `0` / `[]` on error —
deliberately, so a broken segment can never take a campaign screen down with it.
So **every segment carrying a value matched nobody, in complete silence.**

What that looked like from the outside:

- The preview counted **0** against a database with **331** matching customers.
- "At risk", "Lost", "New this month" and "Reward ready" all read 0 on the
  dashboard.
- Every segmented campaign reported a reach of zero.
- The only system segment that worked was **"VIP"** — built from `is_true`, which
  emits no accessor at all — which is precisely why the failure read as an empty
  database rather than a broken query.

The unit suite passed throughout: the compiled SQL had exactly the right *shape*.
The SQL functions were also correct. The defect lived on a boundary neither side's
tests crossed.

## The fix, and the tests that would have caught it

The compiler emits `$1`. Fixed there rather than in SQL because the four functions
are already correct — they bind one parameter, and the placeholder for the first
bound parameter is `$1` — and applied migrations are checksummed.

Two layers of new coverage:

- **Unit:** the emitted SQL must contain `$1` and **must not contain
  `p_params`**, across the value-carrying operators and the list operators (which
  take a different accessor path and had the same defect). No test on output
  *shape* could catch this; only naming the placeholder can.
- **Integration** (`tests/integration/segments.test.ts`, 11 tests): six customers
  with deliberately distinct shapes, then assertions on **counts** rather than
  strings. A predicate the engine cannot parse returns 0, and so does a segment
  that genuinely matches nobody — the only way to tell them apart is to ask a
  question whose answer is known to be non-zero. It also asserts the count
  *narrows* as a threshold rises: a predicate ignoring its parameter returns one
  constant for every threshold, which is the exact shape of the bug.

**Verified after the fix:** `visit_count ≥ 2` matches 331 of Barcelona Barber's
420; `≥ 40` matches 0. Thresholds 0 / 2 / 4 / 9 / 20 return 6 / 4 / 2 / 1 / 0 on
the integration fixture. AND and OR both compose. "Not seen in N days" correctly
includes never-seen customers — the win-back case, and the one where getting it
wrong is worst.

## Remaining, unfixed

A segment definition with an **unrecognised key** (`rules` instead of
`conditions`) is accepted and matches **everybody**. The summary does say "All
customers", so it is honest rather than silent, and the harness asserts that
honesty. But for a campaign send, "everybody" is the worst possible default from a
typo, and `segmentDefinitionSchema` should reject an unknown key rather than
ignore it.

---

# Analytics

**Launch ready. 95%.**

Verified that the numbers come from the data **and move**:

- Record a visit → `engagement.visits` rises. Asserted per workspace, before and
  after, in the same run.
- Redeem a reward → `engagement.redemptions` rises.
- Period revenue equals the sum of purchase events, per workspace.
- The customer count equals `count(*) from customers`, per workspace.
- Retention, churn, average ticket and CLV are **all distinct across the six
  workspaces**. Four businesses of wildly different sizes reporting the same rate
  to one decimal place would be a constant, not a coincidence — that check exists
  and passes.
- The daily series has 31 points for a 30-day window, so the chart does not skip
  quiet days.
- Cohort retention, the twelve-month growth series, top rewards and top customers
  are all populated.
- `stats_updated_at` is set for all 2,765 customers, meaning the recompute has
  actually run.
- The job queue has no failures and no hour-old backlog.

## Issue found and fixed

`passimo_analytics_overview` counts redemptions from `activity_events` where
`type = 'redeem'`. The live redemption path writes one; **the seed did not.** So
the demo reported **0 redemptions** beside a "points redeemed" figure in the
thousands, on the same panel. Fixed in the seed — three tables now agree about
every redemption, and `013_analytics.sql` reconciles them on every run.

**Remaining 5%:** wallet and proximity attribution is computed from seeded event
data rather than from real geofence triggers, which need devices. Campaign
attribution windows are implemented and not exercised end to end, because sending
needs a provider.

---

# AI

**Architecture launch ready. 90%. Activation: credential required.**

Seven actions implemented behind one gated route: campaign copy, insights,
segment suggestion, program optimisation, customer summary, feedback themes and
rewrite. `ai_insights` stores results; `ai_actions_per_month` meters usage (0 on
Starter and Growth, 2,000 on Pro, unlimited on Business).

Verified: the **gate ordering**, which was broken. Starter and Growth get **402**
naming Pro; Pro, Business and the trial get **503 `not_configured`** because there
is no `ANTHROPIC_API_KEY`. Before this pass every caller — including anonymous
ones — got 503 first, which meant the plan gate never ran and a Starter merchant
was told the product was misconfigured instead of being sold an upgrade.

**Not verified:** no AI response has been generated. Prompt quality, output
usefulness, token cost and latency are all unmeasured.

---

# Localization

**Launch ready. 90%.**

Two languages, Spanish (default) and English. `passimo_locale` is a **cookie**, not
`localStorage`, so it is readable during SSR and the first byte is already in the
right language — no flash of the wrong one, and no hydration mismatch.

Verified:

- Five dashboard surfaces render in both locales with a matching `<html lang>`.
- Four public surfaces (`/`, `/login`, `/signup`, `/join/<slug>`) render in both.
- A unit test asserts the Spanish dictionary is not simply the English one.
- `pnpm typecheck` proves every `TranslationKey` referenced in code exists.
- Plan names stay proper nouns in both languages — a merchant on "Growth" who
  reads "Crecimiento" in the product but "Growth" on their invoice has to work out
  that those are the same thing.
- The 404 boundaries added in this pass are localized in both languages.

## Issue found and partly fixed

**API error messages are written once, in English.** That is a defensible
architecture, documented in `lib/client/api-errors.ts`: a route handler has no
view and no locale, so the *browser* localizes from the error's `code` and its
structured `details`.

It worked for the dozen transport-level codes and **silently failed for
`unprocessable` and `conflict`** — which together account for 104 of ~230 error
sites and are the most common refusals in the product. Their meaning is in the
prose: "Not enough balance" and "This reward is out of stock" share a code, so a
client with only the code has nothing to say and fell through to the English
sentence.

The consequence was concentrated exactly where it hurts most: a barista in
Seville, on a Spanish dashboard, taps Redeem on a customer two stamps short and
reads *"Not enough balance to redeem this reward"* — in English, at the till, with
a queue.

**Fix:** `unprocessableBecause` / `conflictBecause` attach a stable `reason` to
the refusals staff meet at speed, and the client translates from it, in both
languages. Sixteen reasons covered: insufficient balance, out of stock, tier too
low, per-customer limit, reward unavailable / not started, no active program,
customer blocked, customer anonymised, four granted-code states and three
gift-card states. The English prose remains the last-resort fallback for the long
tail of configuration-screen validations, which an owner reads once at their own
pace.

**Remaining 10%:** the long tail — roughly 90 `unprocessable` sites on
configuration screens — still falls back to English. Two languages only. No
RTL support.

---

# Mobile

**Mostly ready. 85%.**

Verified by the E2E suite at a **Pixel 7 viewport**, 79 tests:

- **No horizontal scroll at any width** — asserted explicitly.
- Exactly one `main` landmark per page.
- The login form is fully keyboard-operable and labelled.
- All 16 dashboard pages render.
- The customer list is genuinely two layouts — a `<table>` above the `md`
  breakpoint and a `<ul>` of cards below it — and both link each customer to their
  profile. *(This caught a test of my own that asserted table rows and therefore
  passed on desktop while failing on every mobile run.)*
- The PWA manifest is installable and points at `/pos`.
- The service worker is served as executable JavaScript.
- The offline page reassures the merchant their scans are queued.
- Permissions-Policy allows the camera on our own origin and nowhere else; the CSP
  permits the camera stream and the service worker.

**Not verified:** physical devices. Touch-target sizes, the camera scanner, the
Apple/Google Wallet buttons, "Add to Home Screen" on iOS, and one-handed reach at
the counter are all inspection-only.

---

# Security

**Launch ready. 94%.**

Verified against the running API:

| Check | Result |
| --- | --- |
| Unauthenticated access to 8 protected endpoints | 401 |
| `/dashboard` without a session | 307 → `/login`, destination preserved |
| User enumeration on sign-in | Not possible — identical status and message |
| Account lockout | 5 attempts → 15 minutes, per account |
| Password hashing | 100% scrypt, correct encoding |
| Session storage | SHA-256 hashes, never the token |
| Cross-tenant reads (300 probes) | 0 leaks |
| Cross-tenant writes (150 probes) | 0 leaks |
| Merchant → admin console | 403 |
| Cron endpoints without the shared secret | 401 |
| 4 SQL-injection payloads through search | No server error; the customers table survived |
| Stored `<script>` reflected into HTML | Escaped |
| Oversized request body | 413 |
| Malformed input (11 shapes) | 422 with field-level detail |
| Security headers on every response | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, CSP |
| CSP `connect-src` | `'self'` only — an injected script has nowhere to exfiltrate to |
| Stripe webhook, unsigned | Refused |
| Stripe webhook, forged signature | Refused |
| Forged / expired card token | Refused |
| Health endpoint | Leaks no connection string or key |
| Public business endpoint | Does not leak the tenant primary key or anything commercial |

Values never reach SQL text: segment predicates emit indexed JSON parameter
accessors from a closed operator set and a column allow-list, verified against a
live database with an injection payload.

## Issue found and fixed

**Deployment inventory was readable by anonymous callers.** The
capability check ran before authentication, so a stranger could POST to
`/api/v1/ai` or the checkout routes and learn from the 503 whether this deployment
holds an Anthropic or Stripe key. Moved after authentication and the plan gate.

## Remaining

- **No CSRF token.** The session cookie is `SameSite=Lax`, which blocks the
  cross-site POST that matters, and there is no `SameSite=None` surface. Defensible
  and worth a second control before a franchise security review.
- **No MFA**, and no OAuth.
- **RLS off** — see [Database status](#database-status).
- **No penetration test.** No OWASP tooling was run in this pass.
- **`middleware.ts` is a deprecated Next convention** (the build warns). It should
  become `proxy.ts`; no behaviour change, one warning removed.

---

# Performance

**Mostly ready. 80%.** Reviewed statically; not load-tested.

Verified:

- Production build succeeds; 114 routes; the standalone artifact serves its own
  static assets.
- Every index the product's list screens need, exists (`015_data_integrity.sql`).
- No table over 1,000 rows lacks a tenant-scoped index.
- `analytics.overview` is **one** database call, not the eleven sequential round
  trips it once was.
- The customer list uses two grouped reads rather than a per-row subquery — 50
  rows would otherwise be 100 extra round trips.
- Rate limits are enforced per named bucket and fail **open** if the database is
  unreachable: losing a sale to our own outage is worse than letting somebody
  exceed a quota.
- Connection pool capped at 10 per process, with a connect timeout and a statement
  timeout above the slowest legitimate query.
- Entitlements memoised for 15 s, program config for 30 s, both invalidated on
  change.

**Not verified:** no Lighthouse run, no bundle-size budget, no load or soak test,
no `EXPLAIN ANALYZE` against a production-sized dataset. `db.slow_query` warnings
appear during seeding for the customer-stats recompute, which is a bulk operation
by design.

One operational note found in this pass: **the Turbopack dev server exhausted its
V8 heap** (exit 134) after many recompiles during a long verification session.
Not a production concern — production runs the standalone build — but
`NODE_OPTIONS=--max-old-space-size=4096` avoids it on a long day.

---

# API verification

**Launch ready. 96%.**

74 route files under `app/api/v1`. All go through `defineRoute`, which applies —
in this order — request id and logger, rate limit, authentication, schema
validation, tenant resolution and permissions, plan entitlement, deployment
capability, then the handler.

Verified for the critical routes:

| Case | Result |
| --- | --- |
| Valid request | 200 with the documented shape |
| Unauthenticated | 401 |
| Wrong tenant | 403 or 404, never data |
| Missing required field | 422 with `path`, `message`, `code` |
| Malformed field (bad uuid, bad email, bad hex colour, bad enum) | 422 |
| Out-of-range (negative amount, negative cost, oversized pagination, zero adjustment) | 422 |
| Duplicate request with the same idempotency key | Accepted, not double-applied |
| Plan does not include the feature | 402 with `reason`, `feature`, `current_plan`, `suggested_plan` |
| Role does not allow it | 403 |
| Provider not configured | 503, and only after 401 and 402 |
| Rate limit exceeded | 429 with `Retry-After` |
| Oversized body | 413 |
| Every response | carries `X-Request-Id` for support triage |

`scripts/verify-functional.mjs` (new) drives all of this in 939 checks. It
deliberately keeps its own copy of the plan catalogue rather than importing the
module under test: an independent copy is what makes it a test, since a wrong plan
definition would otherwise agree with itself and pass.

## Issue found and fixed

**`POST /api/v1/wallet/rules` accepted a rule that could never fire.** Both
`conditions` and `actions` were optional on create, so a body carrying nothing but
a name produced an active rule with `conditions: {"all": []}` and `actions: []`.
It matched everything, did nothing, counted against the plan's `automation_rules`
quota, and appeared on the merchant's rules screen looking like a rule.
`011_wallet.sql` flags exactly that shape, which is how it surfaced.

`actions` is now required on create and stays optional on update, where a PATCH
may legitimately change only a name or a priority. Empty `conditions` remains
legal — "always fire" is a rule a merchant might genuinely want; an empty action
list is not a rule at all.

**Remaining 4%:** the public REST API (`api_access`) and webhook delivery are
implemented and exercised only by unit test — no API key was issued and no
webhook delivered in this pass. Zapier / Make / Square / SumUp / Shopify /
WooCommerce integrations have route scaffolding and are unexercised.

---

# E2E verification

**Launch ready. 100%.**

`pnpm test:e2e` — **158 tests, all passing**, on Desktop Chrome and a Pixel 7
viewport, against the production build.

| Spec | Covers |
| --- | --- |
| `merchant-journey.spec.ts` | Signup → onboarding → activate → customer → transaction → reward → analytics, and that a signed-out visitor cannot reach any of it |
| `onboarding.spec.ts` | The four-step flow, the first scan with no camera, route protection, the printed QR |
| `public.spec.ts` | Authentication, security headers, the API contract, accessibility basics, mobile layout |
| `counter.spec.ts` | The PWA manifest, the service worker, the offline page, camera and worker policies, counter access control |
| `commerce.spec.ts` | The gift-card shop, billing endpoints, Stripe webhook signature verification, the pricing page, new dashboard routes |
| **`demo-plans.spec.ts`** (new) | Each demo plan in a browser: sign-in, the plan shown in the sidebar, the right features locked, real data on the customer list, the trial countdown, the lapsed workspace still readable and offered a way back, the admin console labelling trials correctly, and a merchant unable to open it |

The new spec exists because the HTTP harness cannot check the half of feature
gating that lives in the DOM: whether a Starter merchant can *see* that campaigns
exist. The two halves fail differently — a missing server gate is a security bug,
a missing client affordance is a pricing bug, because the merchant never learns
the feature exists and so never upgrades.

## Test-quality issues found and fixed

- `getByRole('alert')` unscoped matched both a page's error panel and Next's
  `__next-route-announcer__`, so Playwright's strict mode failed on two matches —
  passing on mobile and failing on desktop in the same run. Scoped to `main`.
- A customer-list assertion on `role="row"` passed on desktop and failed on every
  mobile run, because the list is genuinely a table above `md` and cards below.
  Now counts customer links, which exist in both.
- The spec signed in through the form in every test, exhausting the 30-per-5-minute
  sign-in bucket and skipping 11 tests with "the demo account is not present" — a
  message that was doubly wrong. Now exchanges the credential once per account and
  reuses the cookie; the form itself stays covered by `public.spec.ts`.
- Three specs asserted a client-rendered "does not exist" message on an unknown
  business slug. Making that page answer a real 404 handed the response to Next's
  default page — correct status, worse experience. Fixed properly with localized
  404 boundaries (below), so status *and* message are both right.

---

# Build verification

**Launch ready. 100%.**

| Gate | Command | Result |
| --- | --- | --- |
| Type check | `pnpm typecheck` | **Pass**, clean |
| Lint | `pnpm lint` | **Pass**, 0 errors, **0 warnings** |
| Unit tests | `pnpm test` | **650 passed**, 26 files |
| Integration tests | `pnpm test:integration` | **82 passed**, 5 files |
| Database diagnostics | `pnpm db:verify` | **254 pass, 0 fail, 0 error** |
| Production build | `pnpm build` | **Pass** |
| Production server | `pnpm start` | **Pass**, assets served |
| Functional verification | `pnpm verify:functional` | **939 passed, 0 failed** |
| E2E | `pnpm test:e2e` | **158 passed** |

## Issue found and fixed

**`pnpm start` ran the wrong server.** `next.config.mjs` sets
`output: 'standalone'`, and Next says on every boot that `next start` does not work
with it — the entry point is `.next/standalone/server.js`, which is what the
Dockerfile and `railway.json` both invoke. So the local "does the production build
actually work?" check was testing a different thing from production, and served
from a tree the deployment never uses.

`scripts/serve-standalone.mjs` now copies `.next/static` and `public` into the
standalone tree (Next deliberately does not; the Dockerfile does it in separate
layers) and execs `server.js`, forwarding signals. Verified: the CSS bundle
returns 200 rather than a page of unstyled HTML that looks like a broken build.
`pnpm start:next` remains for the other one.

**One build warning remains:** the `middleware` file convention is deprecated in
favour of `proxy`. Cosmetic, and worth doing.

---

# Remaining problems

Ordered by what I would fix next.

| # | Problem | Impact | Effort |
| --- | --- | --- | --- |
| 1 | **No provider credentials.** Wallet passes, messaging and card payments are the three things a merchant pays for at the edges, and none of the accounts exist. | Cannot self-service launch. Every one is architecture-complete and activates by filling environment variables. | Days of account setup, not engineering |
| 2 | **No pass has been installed on a real device.** The builder, web service and push registration are implemented and unit-tested; nothing has reached an iPhone. | The single largest unknown in the product. | Half a day once an Apple account exists |
| 3 | **A segment definition with an unknown key silently matches everybody.** Honest in its summary, catastrophic as a campaign default. | One typo sends to the entire customer base. | An hour — make `segmentDefinitionSchema` strict |
| 4 | **~90 `unprocessable` error sites still fall back to English.** The counter path is covered; configuration screens are not. | A Spanish merchant meets English on validation errors. | A day |
| 5 | **No Lighthouse or axe audit.** | Accessibility and performance claims are inspection-based. | Half a day |
| 6 | **Camera scanning unverified on physical devices.** iPhone, Android, iPad, tablet, laptop. | The counter is the product's most-used screen. | Half a day with the devices |
| 7 | **No MFA, no OAuth, no CSRF token.** `SameSite=Lax` covers the CSRF case that matters. | Will be asked about in any franchise security review. | Days |
| 8 | **RLS off on all 58 tenant tables.** Deliberate and documented; isolation verified empirically. | Defence-in-depth gap for a future least-privilege role or a BI tool. | Days, and a decision first |
| 9 | **Cashback, membership and tier program types unexercised end to end.** Implemented and unit-tested; no demo workspace uses them. | Three advertised program types with the same class of risk the points bug had. | A day — add a demo workspace for each |
| 10 | **`passimo_platform_overview.mrr_cents` counts trials as revenue.** Unread — TypeScript recomputes it — but dead and misleading. | None today; a trap for the next reader. | An hour and a migration |
| 11 | **`middleware.ts` uses a deprecated Next convention.** | One build warning. | Ten minutes |
| 12 | **CSV import, customer merging and the public REST API verified only by unit test.** | Three surfaces with no end-to-end evidence. | A day |
| 13 | **`coverUrl` is stored, editable and renders nowhere.** | A brand field that does nothing. | An hour, or remove it |
| 14 | **No load testing.** Pool sizing, index coverage and query shapes reviewed statically only. | Unknown behaviour above a few hundred concurrent merchants. | A day |

---

# Fixes applied in this pass

## Product defects

| # | Defect | Files |
| --- | --- | --- |
| 1 | Segmentation matched zero customers — a parameter accessor named after the PL/pgSQL argument instead of the placeholder | `lib/segments/compile.ts` |
| 2 | Points and cashback programs could not reach their own goal — program type and earning rules set in two places that never spoke | `lib/loyalty/default-rules.ts` (new), `app/api/v1/programs/route.ts` |
| 3 | A blocked or anonymised customer was still credited and could still be handed rewards | `lib/loyalty/engine.ts` |
| 4 | The deployment-capability check ran before authentication — leaking configuration to anonymous callers and telling unentitled merchants the product was broken | `lib/api/handler.ts` |
| 5 | The admin console labelled every live trial "Inactive", counting trials as churn | `lib/admin/platform.ts`, `app/admin/page.tsx`, `lib/billing/entitlements.ts` |
| 6 | The public join page — the product's only conversion point — was client-rendered: HTTP 200 for an unknown business, no brand in the first paint, generic link previews | `app/join/[businessSlug]/page.tsx`, `join-flow.tsx` (new), `lib/public/join.ts` (new) |
| 7 | No 404 boundary anywhere — unknown routes rendered Next's unstyled English default | `app/not-found.tsx`, `app/join/[businessSlug]/not-found.tsx` (both new) |
| 8 | Counter refusals reached Spanish screens in English | `lib/errors.ts`, `lib/client/api-errors.ts`, both dictionaries, `lib/loyalty/engine.ts`, `lib/commerce/gift-cards.ts` |
| 9 | `passimo:card.<token>` — a documented scheme form — resolved to nobody | `lib/scan/payload.ts` |
| 10 | Starter declared limits its own feature gates made unreachable | `lib/billing/plans.ts` |
| 11 | Campaigns and automations showed no lock for plans that cannot use them | `app/dashboard/layout.tsx` |
| 12 | `pnpm start` ran a server Next says does not work with this config | `scripts/serve-standalone.mjs` (new), `package.json` |
| 13 | `POST /api/v1/wallet/rules` accepted a body with only a name, creating an *active* automation rule with no conditions and no actions — inert, counting against the plan's quota, and sitting on the merchant's rules screen looking like a rule | `lib/api/wallet-schemas.ts` |

## Schema

| Migration | Change |
| --- | --- |
| `000022_tenant_key_not_null.sql` | `business_id` NOT NULL on the seven tables where it is required; the four deliberate exceptions documented on the columns themselves |
| `000023_deletable_workspace.sql` | `passimo_delete_business(uuid)` — the one sanctioned route through the ledger immutability guard, so a workspace can be deleted at all; the guard still refuses a direct delete |

## Demo data

Redemption records, `redeem` activity events, `lifetime_redeemed`,
`rewards.redeemed_count`, marketing consent with timestamps, referrals in three
states, per-trade ticket ranges so every goal is reachable, wallet card designs,
per-plan team rosters, trial and lapsed workspaces, unique ledger timestamps,
plan-accurate geofencing, and automatic clearing of test residue.

## Tooling added

| Path | Purpose |
| --- | --- |
| `scripts/db/` (15 files + README) | Diagnostic query suite with PASS/WARNING/FAIL verdicts |
| `scripts/db-verify.ts` | Runner that turns those verdicts into an exit code (`pnpm db:verify`) |
| `scripts/verify-functional.mjs` | 939-check HTTP harness across every plan (`pnpm verify:functional`) |
| `scripts/serve-standalone.mjs` | Runs the production artifact the way the deployment does |
| `tests/integration/segments.test.ts` | 11 tests running the compiler against the real SQL function |
| `tests/e2e/demo-plans.spec.ts` | 21 browser tests per viewport across all six plans |

## Test-quality fixes

A structural contrast test timing out under load (muted checks are worse than
none), an unscoped `alert` locator matching Next's route announcer, a
desktop-only table assertion, and an E2E spec exhausting the sign-in rate limit
and mis-reporting it as missing demo accounts.

---

# Launch recommendation

**Ready for a hand-held pilot cohort of paying merchants. Not ready for
self-service public launch.**

That is the same conclusion the previous status reached, and it is now better
supported — but the reason has changed. It used to be "the gap is not code". Some
of it was code, and this pass found three paid features that did nothing:
segmentation, points programs, and customer blocking. All three were invisible by
construction. Any of them would have been found by the first pilot merchant, and
the points bug would have been found by the first *gym* — with their card printed.

## What can be launched now, with confidence

A merchant can sign up, complete onboarding in four steps, design a wallet card,
add a location, print a QR, enrol customers from a public page that is branded in
its first byte, scan those customers at the counter on any device with a browser
(camera or manual), award stamps or points that actually accrue toward a
reachable goal, hand over rewards with per-customer limits and replay safety,
segment their customer base, build campaigns and automations, and read analytics
that move when they do something. Every plan gate holds in both directions.
Tenant isolation holds across 450 probes and ~50 data-shape checks. A lapsed
workspace keeps all its data and can still serve a customer at the counter.

## What a pilot merchant must be told before they sign

1. **Their customers cannot install a wallet pass yet.** Apple and Google
   credentials do not exist. This is the product's headline promise and it is
   currently a browser card page — good, and not the same thing.
2. **The product cannot send them anything.** No email, SMS or WhatsApp until
   Resend is configured. Campaigns compose, segment, schedule and refuse to send.
3. **They cannot pay by card in-product.** No Stripe. Invoice them directly.
4. **AI features return "not configured."**

All four are environment variables, and the product reports each one honestly
rather than pretending. That honesty is the reason a pilot is viable at all.

## Before self-service launch

The four credentialed integrations, a real pass on a real iPhone, a Lighthouse and
axe pass, camera verification on physical devices, and items 3–4 from the
[remaining problems](#remaining-problems) table — strict segment schemas and the
long tail of error localization.

## The evidence

Anybody can reproduce every number in this document:

```bash
pnpm db:up && pnpm db:reset && pnpm seed:demo
pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration && pnpm db:verify
pnpm build && pnpm start &
pnpm verify:functional
pnpm test:e2e
```

**"Can someone clone this repository, start the database, seed demo data, log into
each Passimo plan and actually use the product?"**

Yes. It is five commands, and **2,083 automated checks** say so — 650 unit, 82
integration, 254 database diagnostics, 939 functional over HTTP, 158 in a
browser.

---

# Related

- [`DEMO_CREDENTIALS.md`](DEMO_CREDENTIALS.md) — accounts, per-plan test scripts,
  the verified feature matrix.
- [`docs/DEMO_TESTING.md`](docs/DEMO_TESTING.md) — how to exercise every feature
  by hand.
- [`docs/DATABASE_VERIFICATION.md`](docs/DATABASE_VERIFICATION.md) — the
  diagnostic query suite and what each file answers.
- [`PASSIMO_LAUNCH_STATUS.md`](PASSIMO_LAUNCH_STATUS.md) — the prior status. Its
  verification figures are superseded by this document; its architecture and
  brand-migration sections still hold.
