# Database verification

How to look at a Passimo database and decide whether it is healthy — connecting,
running the diagnostics, resetting, seeding, and the specific questions each query
answers.

Every query lives in [`scripts/db/`](../../scripts/db). They are read-only: run
them against production if you need to.

---

## Contents

- [Connecting](#connecting)
- [Running the diagnostics](#running-the-diagnostics)
- [Resetting and seeding](#resetting-and-seeding)
- [The query suite](#the-query-suite)
- [Verifying tenant isolation](#verifying-tenant-isolation)
- [Verifying plans and subscriptions](#verifying-plans-and-subscriptions)
- [Verifying transactions](#verifying-transactions)
- [Verifying analytics](#verifying-analytics)
- [Verifying wallet state](#verifying-wallet-state)
- [Deleting a workspace](#deleting-a-workspace)
- [Reading the output](#reading-the-output)
- [Known warnings](#known-warnings)

---

## Connecting

The connection string is `DATABASE_URL`. It is the only database configuration
the application has — there is no vendor client in front of PostgreSQL.

**Local (Docker).** `docker-compose.yml` runs PostgreSQL 16 on port **5433**, not
5432, because a machine with a native PostgreSQL service on 5432 gives you
"password authentication failed" against a database whose password is definitely
correct.

```bash
pnpm db:up                    # start it
docker compose logs postgres  # if it will not start
```

```
DATABASE_URL=postgresql://passimo:passimo@127.0.0.1:5433/passimo
```

**With `psql` on the host:**

```bash
psql "$DATABASE_URL"
psql "$DATABASE_URL" -f scripts/db/001_health_check.sql
```

**Without `psql` on the host** — likely, since the database is in a container:

```bash
docker exec -it passimo-postgres psql -U passimo -d passimo
docker exec -i passimo-postgres psql -U passimo -d passimo < scripts/db/001_health_check.sql
```

**Production (Railway).** Take `DATABASE_URL` from the service variables. TLS is
handled by `lib/db/pool.ts`: managed providers terminate TLS with certificates
that are not in Node's trust store for the internal hostnames they hand out, so
verification is off unless `DATABASE_SSL=verify`.

Never paste a production connection string into a file. Export it for the length
of a shell session and let it go.

---

## Running the diagnostics

### The runner (what CI should call)

```bash
pnpm db:verify              # every file, PASS/WARNING/FAIL summary, exit 1 on any FAIL
pnpm db:verify --verbose    # every row of every query
pnpm db:verify 014          # only files whose name contains "014"
```

Why a runner rather than a `for` loop over `psql`: the loop exits 0 whatever the
queries returned, because a query that reports `FAIL` in a column is still a
successful query. `scripts/db-verify.ts` reads the `status` column the files are
written to produce and turns it into an exit code. It uses the same `pg` pool the
application uses, so it needs no `psql` on the host.

`WARNING` does **not** fail the run. A warning means "a human should look at
this" — an unbranded workspace, an index nobody has queried yet — and gating a
build on those trains everybody to pass `--force`.

### One file at a time, for reading

```bash
docker exec -i passimo-postgres psql -U passimo -d passimo < scripts/db/007_transactions.sql
```

### Everything into a file you can attach to a bug report

```bash
for f in scripts/db/0*.sql; do
  docker exec -i passimo-postgres psql -U passimo -d passimo < "$f"
done > db-report.txt
```

---

## Resetting and seeding

```bash
pnpm db:up          # start PostgreSQL
pnpm db:migrate     # apply pending migrations
pnpm db:status      # what is applied, what is pending
pnpm db:reset       # drop the public schema and replay every migration from empty
pnpm seed:demo      # six demo workspaces (see DEMO_CREDENTIALS.md)
pnpm setup          # all three: up, migrate, seed
```

`pnpm db:reset` is destructive and does not ask. It drops `public` and replays
all 24 migrations from nothing, which is the only way to prove the repository is
reproducible — a schema that only exists because of a sequence of manual fixes is
a schema nobody else can build.

The migration runner records a SHA-256 per file and **refuses to run when an
applied migration's contents change.** That is why the older migrations still
say `fidelio_*` in places: editing them, even a comment, breaks `pnpm db:migrate`
on every deployed database. Migration `000017` renames every routine to
`passimo_*` and asserts none remain.

`pnpm seed:demo` is idempotent — re-running updates the same six workspaces
rather than creating a seventh Madrid Coffee — deterministic (a seeded PRNG, so
two developers see identical numbers), and it refuses to run against anything
that is not localhost or `NODE_ENV=development`. It also clears test residue
first: the functional harness and the integration fixtures both create
throwaway workspaces, and left alone they accumulate in the admin console beside
the curated demo data.

---

## The query suite

| File | Answers |
| --- | --- |
| `001_health_check.sql` | Is this database alive, migrated, and the right shape? Version, migration ledger, expected tables and functions, row counts, index coverage, unused indexes, tables with no primary key, long-running queries. |
| `002_merchants.sql` | Which workspaces exist, on what plan, with how much in them. Flags a workspace that cannot award anything (no program), cannot pay out (no reward) or has no location. Slug shape and uniqueness, owner integrity, branding completeness, onboarding progress. |
| `003_users.sql` | Who can sign in, with what role. Accounts that *cannot* sign in and why — locked, suspended, unverified, no password. Password hash format (must be scrypt, six segments), duplicate emails, live sessions, token storage, team roles, platform admins. |
| `004_subscriptions.sql` | The catalogue as the application defines it; stored plan values the application recognises; no free tier in the data; each workspace's billing state; contradictions; live usage against every limit; metered counters; Stripe webhook events and duplicates; dunning. |
| `005_loyalty_programs.sql` | Every program and rule. Programs that cannot reward anybody, configuration that contradicts its own type, rules that can never fire, which triggers are actually wired up, tier setup. |
| `006_customers.sql` | The customer base per workspace, and whether the demo covers every state the dashboard has UI for. Derived stats recomputed and compared. Reachability, duplicates, referral codes, RFM/churn scoring, tags and notes, consent and GDPR state. |
| `007_transactions.sql` | **The most important invariant in the product**: balance must equal the sum of the ledger. Also `lifetime_earned`, `balance_after` running totals, negative balances, sign/type agreement, idempotency, activity events, scan throughput, expiring balances, outstanding liability. |
| `008_rewards.sql` | Is the catalogue reachable, priced, in stock and in date? Rewards nobody can claim, rewards priced above any balance ever held, auto-grant coverage, duplicates, `redeemed_count` drift, cross-tenant links, reward performance. |
| `009_redemptions.sql` | Redemptions against the ledger and against the reward's own limits. Ledger debits matching costs, both directions of the relationship, per-customer limits, stock, code uniqueness, expiry, cross-tenant rows, and the claim rate. |
| `010_campaigns.sql` | What has been sent, to whom, and what it did. Campaigns that could not have reached anybody, reachable audience per channel, copy completeness, scheduling sanity, counter consistency, automations, runs, messages, suppression list. |
| `011_wallet.sql` | Card design per workspace, colour validity, brand-kit single-source-of-truth, pass installs and install rate, registrations with no push token, wallet settings, features enabled on a plan that does not include them, proximity campaigns and rules, the event funnel, sync backlog. |
| `012_locations.sql` | Geocoding coverage — the number that decides whether proximity works at all. Primary-location uniqueness, implausible coordinates, geofence radii, geofences with no trigger, dwell configuration, locations against the plan's limit, timezones, opening hours, orphans. |
| `013_analytics.sql` | Whether the dashboard numbers come from the data and whether they move. Runs the real functions, recounts independently, and checks that metrics are not suspiciously identical across workspaces of different sizes. |
| `014_tenant_isolation.sql` | **Critical.** Every tenant-scoped table has the column, NOT NULL where required, a foreign key, and cascade. Then ~50 relationship checks for the shape a leak leaves behind: a row whose `business_id` disagrees with something it points at. |
| `015_data_integrity.sql` | Orphans, duplicate natural keys, the unique constraints that must exist, impossible states, suspicious nulls, the indexes the product needs, sequential scans, table sizes. Ends with one verdict. |

---

## Verifying tenant isolation

The one to run before any release.

```bash
pnpm db:verify 014
```

Multi-tenancy here is a `business_id` column on 58 tables plus an application
layer that scopes every query. That works, and it fails silently: one missing
`.eq('business_id', ...)` leaks one merchant's customer list to another, and
nothing errors, nothing logs, and no test on either tenant in isolation notices.

So `014` does not test the application. It tests the **data** for the shape a leak
leaves behind:

```sql
-- must never return a row
select count(*) from loyalty_ledger x
  join customers y on y.id = x.customer_id
 where y.business_id <> x.business_id;
```

There are about fifty of these, covering the ledger, accounts, redemptions,
rewards, rules, tiers, events, notes, tags, campaigns, automations, messages,
wallet registrations and events, proximity campaigns and their locations,
referrals, team members, gift cards, memberships, surveys and webhooks. One row
from any of them is a P0.

`014` also verifies the structure that makes those rows impossible: the column
exists on every tenant table, it is NOT NULL wherever it is required (migration
`000022`; four columns are nullable on purpose and are named), it has a foreign
key, and every one of the 58 keys is `on delete cascade`.

**Row-level security is off, by design.** Migration `000018` removed thirty-odd
policies and explains why at length: they were written for an architecture where
the browser queries PostgreSQL directly, Passimo has never worked that way, and a
table owner bypasses its own policies unless the table is FORCEd — which none
were. They were evaluated for zero queries while reading, to anyone browsing the
schema, as protection that existed. So `014` checks the *opposite* of "is RLS
on": that no policy has been left behind claiming to isolate tenants.

To verify isolation from the *application* side rather than the data side:

```bash
pnpm verify:functional
```

It signs in as each demo merchant and fires 300 cross-tenant read probes and 150
write probes across every pair of workspaces.

---

## Verifying plans and subscriptions

```bash
pnpm db:verify 004
```

The catalogue lives in `lib/billing/plans.ts`, not in the database: plan shape is
product strategy, identical for every tenant, changes with a deploy, and needs to
be readable on the client without a round trip. So `004` inlines the catalogue and
asserts the *column* against it. **If the two ever diverge, the inline copy in the
SQL is the thing that is wrong.**

What it establishes:

- Four purchasable tiers, entry price $5, **no free tier**.
- No legacy `free` / `enterprise` values survive (migration 15 rewrote them).
- `businesses.plan` holds only `trial`, `lapsed`, `starter`, `growth`, `pro`,
  `business`. Anything else is gated as lapsed by `resolveEntitlements`, which
  silently downgrades a paying customer.
- Each workspace's effective plan: a live `trial` resolves to Pro, an expired one
  to lapsed. **`plan` and `effective_plan` are different fields and reading the
  wrong one is a real bug** — the admin console labelled every live trial
  "Inactive" for exactly this reason.
- Live usage against every countable limit, measured the same way the API
  enforces it. `lapsed` is over its limits by definition and is reported as PASS:
  the cap of 0 is what refuses a write, not a claim about what exists.
- Stripe webhook events, and whether any arrived and failed.

---

## Verifying transactions

```bash
pnpm db:verify 007
```

The invariant:

```sql
-- balance must equal the sum of the ledger
select a.id, a.balance, coalesce(sum(l.amount), 0) as ledger_sum
  from loyalty_accounts a
  left join loyalty_ledger l on l.account_id = a.id
 group by a.id, a.balance
having abs(a.balance - coalesce(sum(l.amount), 0)) > 0.001;
```

A mismatch means either a write bypassed the ledger or a ledger entry was written
without adjusting the account. Both produce a wallet card whose balance is not
defensible to the customer holding it.

`007` also checks `lifetime_earned` against the sum of credits, `balance_after`
against a recomputed running total (which catches an entry inserted out of order
or backdated after the fact — invisible in the final balance, fatal to every
history view), that no balance is negative, that entry types and signs agree, and
that idempotency keys are unique per workspace with a unique index behind them.

To see a transaction actually move a balance, rather than just be consistent:

```bash
pnpm verify:functional
```

It creates a customer, records a €42.50 purchase, asserts the balance rose by the
right amount, replays the same idempotency key and asserts it did **not** rise
again, then redeems and asserts the redemption reaches the ledger, the
redemptions table and the analytics figure.

---

## Verifying analytics

```bash
pnpm db:verify 013
```

The failure this file is written to catch is a metric that is *stable* — a
retention rate reading 56.8% on a database with four rows and on one with four
million, because it comes from a constant somewhere. So every check recomputes the
figure independently and compares:

- `passimo_analytics_overview` runs for every workspace without erroring.
- Its customer count matches `count(*) from customers`.
- Its redemption count matches `count(*) from reward_redemptions` in the window.
  (This one caught a real defect: the function counts `activity_events` where
  `type = 'redeem'`, the live redemption path writes one, and the seed did not —
  so the demo reported 0 redemptions beside a "points redeemed" figure in the
  thousands.)
- Its period revenue matches the sum of purchase events.
- The metrics are **not identical** across workspaces of wildly different sizes.
- The daily series has one point per day, so the chart does not skip quiet days.
- `stats_updated_at` is populated, meaning the nightly recompute has actually run.
- The job queue has no failures and no hour-old backlog.

---

## Verifying wallet state

```bash
pnpm db:verify 011
```

This file separates three things that all look like "wallet is broken":

1. **Configuration missing** — no `wallet_card_designs` row, so the pass builder
   falls back to platform defaults and the merchant's choices reach nothing.
2. **Credentials missing** — Apple/Google environment variables absent. Read the
   `providers` array from `GET /api/v1/wallet/design?businessId=…`: each provider
   reports `configured` and, when false, the exact variables it needs.
3. **Nobody installing** — the install rate. A customer who enrolled but did not
   install will never see a notification, which makes this the best single measure
   of whether the join flow works.

It also checks colour validity (a malformed hex produces a pass Apple rejects and
a merchant who sees "could not add to Wallet" with no explanation), the brand-kit
single source of truth (migration `000021` retired
`wallet_settings.brand_color`), registrations with no push token, geofencing
enabled on a plan that does not include it, and proximity campaigns that cannot
fire.

---

## Deleting a workspace

```sql
select passimo_delete_business('<business-uuid>');
```

**Not `delete from businesses`.** Every tenant-scoped foreign key is `on delete
cascade`, the cascade reaches `loyalty_ledger`, and `trg_ledger_guard` refuses
every DELETE on that table:

```
loyalty_ledger rows are immutable; post a reversal instead
```

That is the right rule for an accounting ledger and the wrong rule for a cascade,
and until migration `000023` it meant **no workspace that had ever recorded a
single stamp could be deleted at all** — so account closure was impossible and
every test fixture leaked.

`passimo_delete_business` is the one sanctioned route through the guard. It sets a
session-scoped permission with `set local` (released when the transaction ends,
so a pooled connection cannot carry it into somebody else's statement), deletes
the business, and returns what it removed. A bare `delete from loyalty_ledger` is
still refused.

It does **not** delete the owning account: a person may own more than one
workspace, and `businesses.owner_id` cascades, so removing the account because one
workspace closed would take the others with it.

**Customers are anonymised, not deleted.** `passimo_anonymize_customer` strips the
personal data and keeps the ledger, which is what GDPR art. 17(3) allows and what
the merchant's accounts need. `DELETE /api/v1/customers/{id}` calls it.

---

## Reading the output

Every check that can have a verdict returns one in the first column.

| Status | Meaning |
| --- | --- |
| `PASS` | The invariant held. The row still shows the number, so a pass is evidence rather than an assertion. |
| `WARNING` | Something a human should look at, which the application tolerates. Does not fail `pnpm db:verify`. |
| `FAIL` | A broken invariant. Investigate before releasing. |
| `INFO` | A documented design decision reported so it is not a surprise (RLS being off). |

`0 rows` is a **pass** for the leak and orphan queries — every one is written so
that returning nothing is the correct outcome and a row is a finding. Where that
would be ambiguous the query aggregates instead, so it always returns exactly one
row with a verdict.

---

## Known warnings

On a freshly seeded local database `pnpm db:verify` reports **254 pass, 23
warning, 0 fail**. All 23 are expected. Do not "fix" them without reading why.

| Warning | Why it is expected |
| --- | --- |
| 15 × *unused index* | `idx_scan = 0` on a database that has served no traffic. Every index nobody has queried yet reads as unused. Meaningful only after real load. |
| 4 × *index count = 1 on a tenant table* | `business_onboarding`, `wallet_settings`, `wallet_card_designs` and `nps_responses` are keyed on `business_id` alone, so the primary key *is* the tenant index. A second one would be write cost with no read benefit. |
| *RLS disabled on 58 tenant tables* | By design. See migration `000018`. |
| 4 × *paid tier, active status, no Stripe subscription* | Correct for a demo or self-hosted deployment with no Stripe credentials. A finding on production. |
| 2 × *reward priced above any balance held* | Madrid Coffee's auto-created "Free item" (cost 10 against a goal of 8) and Sevilla's birthday cake discount (400 against a goal of 200). Both are pricing decisions worth showing the merchant, not defects. |

---

## Related

- [`DEMO_CREDENTIALS.md`](../DEMO_CREDENTIALS.md) — sign-in details per plan.
- [`docs/DEMO_TESTING.md`](DEMO_TESTING.md) — how to exercise every feature.
- [`FUNCTIONAL_VERIFICATION_REPORT.md`](../FUNCTIONAL_VERIFICATION_REPORT.md) —
  what was verified, what was fixed, what remains.
- [`docs/POSTGRESQL.md`](POSTGRESQL.md) — schema, pooling and migration design.
- [`docs/OPERATIONS.md`](OPERATIONS.md) — backups, incidents, scheduled jobs.
