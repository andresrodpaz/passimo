# Database verification queries

Read-only diagnostics for a Passimo database. Every file answers one question a
developer actually asks when something looks wrong, and every check that can
have a verdict returns one — `PASS`, `WARNING` or `FAIL` — in the first column,
so the output can be skimmed rather than interpreted.

```bash
# One file
psql "$DATABASE_URL" -f scripts/db/001_health_check.sql

# Everything, into a file you can attach to a bug report
for f in scripts/db/0*.sql; do psql "$DATABASE_URL" -f "$f"; done > db-report.txt

# Against the local docker database without a psql on the host
docker exec -i passimo-postgres psql -U passimo -d passimo < scripts/db/001_health_check.sql
```

There is also a runner that executes all of them and exits non-zero on any
`FAIL`, which is what CI should call:

```bash
pnpm db:verify
```

| File | Answers |
| --- | --- |
| `001_health_check.sql` | Is this database alive, migrated and the right shape? |
| `002_merchants.sql` | Which workspaces exist, on what plan, with how much in them? |
| `003_users.sql` | Who can sign in, with what role, and is anything locked out? |
| `004_subscriptions.sql` | What is each workspace being billed for, and does it agree with the catalogue? |
| `005_loyalty_programs.sql` | Is every workspace's loyalty engine configured coherently? |
| `006_customers.sql` | What does the customer base look like, and are the derived stats sane? |
| `007_transactions.sql` | Are earn events landing, balancing and idempotent? |
| `008_rewards.sql` | Is the reward catalogue reachable, priced and in stock? |
| `009_redemptions.sql` | Are redemptions consistent with balances and reward limits? |
| `010_campaigns.sql` | What has been sent, to whom, and what did it do? |
| `011_wallet.sql` | Pass registrations, card designs, proximity configuration and events. |
| `012_locations.sql` | Are locations geocoded, in-bounds and usable as geofences? |
| `013_analytics.sql` | Do the analytics functions return movement, and does it match the ledger? |
| `014_tenant_isolation.sql` | **Critical.** Can any row belong to two tenants at once? |
| `015_data_integrity.sql` | Orphans, duplicates, invalid states, missing constraints. |

## Conventions

- **Read-only.** Nothing here writes. Run it against production if you need to.
- **Status first.** `FAIL` means a broken invariant. `WARNING` means something a
  human should look at but which the application tolerates. `PASS` means the
  invariant held, and the row still shows the number so a passing check is
  evidence rather than an assertion.
- **`0 rows` is a pass** for the leak and orphan queries. Every one of them is
  written so that returning nothing is the correct outcome; a row is a finding.
  Where that would be ambiguous, the query aggregates instead so it always
  returns exactly one row with a verdict.
- **No `SELECT *`.** A query that dumps a table tells you nothing you did not
  already know.
