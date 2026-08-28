# PostgreSQL

Passimo talks to a plain PostgreSQL server. There is no vendor SDK in the path,
and the only coupling to a database host anywhere in the product is
`DATABASE_URL`.

- **Development** — a `postgres:16-alpine` container from `docker-compose.yml`
- **Production** — Railway PostgreSQL, or anything else speaking the protocol
- **Minimum version** — 14. Developed and tested against 16.

Status: **implemented**. Every claim below is exercised by
`tests/integration/` against a real server, and by the `database` job in CI.

---

## 1. What is in the database

64 tables, 58 `plpgsql` functions, 232 indexes, applied by 21 migrations.

Three extensions, declared in `db/migrations/000000_identity.sql` rather than
assumed — a managed host tends to pre-install them and a plain container does not:

| Extension | Why |
| --- | --- |
| `pgcrypto` | `gen_random_uuid()` for every primary key |
| `citext` | Case-insensitive email, so `Ana@shop.com` and `ana@shop.com` are one account — enforced by the type, not by remembering to `lower()` at each call site |
| `pg_trgm` | Trigram indexes behind customer search |

**Transactional logic lives in the database.** Earning points, redeeming a
reward, claiming a job, issuing a gift card and rate limiting are `plpgsql`
functions, because those are the operations that must be atomic under
concurrency. `passimo_credit_account` takes a row lock, honours an idempotency
key, and appends to `loyalty_ledger`. Nothing reads a balance into JavaScript and
writes it back. That design predates the move off the previous provider and is
unchanged by it — only the transport changed.

---

## 2. The query layer

`lib/db/` is roughly 1,200 lines in four files.

| File | Responsibility |
| --- | --- |
| `pool.ts` | One `pg.Pool`, type parsers, slow-query logging, graceful shutdown |
| `introspect.ts` | Foreign keys, column types, unique indexes, function shapes — read once from the catalogue and cached |
| `select.ts` | Parser for the `select()` string, including embedded resources |
| `query.ts` | The builder: compiles a fluent chain to parameterised SQL |

### Why it looks like a REST client

```ts
const { data, error } = await getDb()
  .from('customers')
  .select('id, name, rewards:reward_id (name)', { count: 'exact' })
  .eq('business_id', businessId)
  .order('created_at', { ascending: false })
  .range(0, 24)
```

That shape appears in roughly 460 places. Rewriting all of them by hand as part
of an infrastructure migration would have meant 460 opportunities to drop a
`business_id` filter in a multi-tenant product. The call sites are the part of
this system that has been reviewed and tested; the transport underneath them is
the part that was being replaced. Keeping the surface identical made the change
reviewable.

It is **not** an ORM. It covers exactly the operations this product performs and
throws on anything it does not recognise, rather than guessing.

### Safety properties, enforced here rather than trusted at call sites

- **Every value is a bound parameter.** Identifiers are validated against
  `/^[A-Za-z_][A-Za-z0-9_]*$/` and quoted; there is no path from a value to SQL
  text. A `select()` string containing `name; drop table customers` throws at
  parse time.
- **`update` and `delete` require a filter.** An unfiltered write on a
  multi-tenant table is the worst bug this product could ship, so it is a hard
  error rather than a code-review convention. A deliberate whole-table operation
  has to say so, or belongs in a migration.
- **Errors are returned, not thrown**, matching how every call site already
  handles `{ data, error }`. SQLSTATE is mapped to the HTTP status the API layer
  expects: `23505` → 409, `23514` → 422, `22P02` → 400.

### What introspection buys

Three things the layer cannot guess, all read from `pg_catalog` on first use:

**Column types**, so `in()` casts correctly. `col = any($1::uuid[])` keeps the
index; bound as `text[]` against a `uuid` column, PostgreSQL either errors or
sequentially scans. It also disambiguates a JavaScript array, which is a valid
value for both a `text[]` column and a `jsonb` one — `pg` guesses the former, so
an array written to `jsonb` would fail and an object written to `text[]` would
fail differently.

**Foreign keys**, so `select('rewards:reward_id (name)')` becomes a lateral join.
The database already knows which columns relate two tables; hard-coding a map
would drift.

**Unique indexes including their predicates**, which is the subtle one. Several
of this schema's uniqueness rules are conditional — one row per non-null
`idempotency_key`, one team membership per business and user *where a user
exists*, one default location per business. PostgreSQL expresses those as partial
unique indexes, and `ON CONFLICT (columns)` does **not** match a partial index:
it raises `42P10`, "no unique or exclusion constraint matching the ON CONFLICT
specification". The builder reads the predicate and restates it, which is what
makes `upsert({…}, { onConflict: 'idempotency_key' })` resolve to
`idx_jobs_idempotency` instead of failing. This was a live bug before the
migration and is covered by `tests/integration/query-builder.test.ts`.

### Typing

`data` defaults to `any`, deliberately and with regret. The transport this layer
replaced was untyped: `data` arrived as `any` at every one of those 460 call
sites, which is why they narrow with explicit casts and local row types.
Defaulting to `unknown` would be more correct in isolation and would produce
several hundred type errors whose only honest fix is generating types from the
schema — a worthwhile project, and not one to smuggle into an infrastructure
migration.

The generics are exposed so new code opts in: `db.from<CustomerRow>(…)` and
`.maybeSingle<CustomerRow>()` both type `data` properly, and
`lib/auth/users.ts` and `lib/auth/session.ts` do exactly that.

**Roadmap.** Generate row types from the schema and flip the default. Tracked in
`PASSIMO_LAUNCH_STATUS.md`.

---

## 3. Migrations

```bash
pnpm db:migrate            # apply everything pending
pnpm db:status             # what is applied, what is not
pnpm db:migrate --dry-run  # print the plan
pnpm db:reset              # drop the schema and re-apply from scratch
```

`scripts/migrate.ts` needs nothing but `pg` and Node, which is why the production
container runs the same file rather than a compiled copy.

Four properties, each of which cost something elsewhere:

**One ledger, checksummed.** `schema_migrations` records the filename and the
SHA-256 of the file that was applied. A file edited after it ran is a hard
failure, not a warning: a database whose ledger says "000006 applied" while
000006 on disk says something else is a database nobody can reason about, and the
failure has to happen at deploy time rather than at the first query that depends
on the difference. Line endings are normalised, so a CRLF checkout does not read
as a different file from the one applied on Linux.

**Each migration in its own transaction.** PostgreSQL has transactional DDL, so a
migration that fails halfway leaves nothing behind and the same command can be
run again after the fix. The ledger insert is inside the same transaction, so
"applied" and "recorded" cannot disagree.

**An advisory lock around the whole run.** Railway rolls deployments: two
containers can start within milliseconds of each other and both find the same
migration pending. `pg_advisory_lock` makes the second wait and then find nothing
to do, instead of both running `create index` on the same table.

**No down migrations.** A rollback of a schema change that has already accepted
writes is a data-loss decision, and a generated `drop column` is the worst
possible way to make it. Roll forward.

### Why the early files still say `fidelio_`

Migrations 1–16 create objects with a `fidelio_` prefix and migration 000017
renames every one of them to `passimo_`. That is deliberate. Migration history is
a ledger, not a source file: rewriting it would make a fresh database and an
already-deployed one reach the same state by different routes, which is the class
of difference nobody finds until a production restore. A fresh database creates
`fidelio_*` and renames; a deployed one just renames. Both converge on exactly
the same catalogue, and the verification block at the end of 000017 fails the
migration if they do not.

Confirm on any database:

```sql
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'fidelio\_%';   -- 0
```

### The identity migration

`000000_identity.sql` is new. Accounts previously lived in a schema this
repository did not own or migrate, which meant a restore produced a database full
of businesses whose owners did not exist. `app_users`, `user_sessions` and
`user_tokens` are now ordinary tables, and every
`references auth.users (id)` in migrations 1–17 points at `app_users`.

### The row-level-security migration

`000018_row_level_security_realignment.sql` drops thirty-odd policies and
disables RLS on nine tables. Its header is the long version; the short version is
that they were inert on every deployment this product has ever had — the
application has always queried over a connection that owns the schema, and a
table owner bypasses its own policies — and inert policies read as protection
that exists. Tenant isolation is enforced in the application layer, explicitly,
and `tests/integration/tenant-isolation.test.ts` is what stands in their place.
See `docs/SECURITY.md`.

---

## 4. Connection pooling

Ten connections per process by default (`DATABASE_POOL_MAX`). Next.js may hold
several instances and each multiplies the count against a database whose
`max_connections` is usually 100; ten leaves room for the migration runner and a
`psql` session during an incident.

- `connectionTimeoutMillis` 10s — fail fast with an actionable 503 rather than
  hanging until the load balancer gives up
- `statement_timeout` 30s — above the slowest legitimate statement (the analytics
  recompute), so a timeout means "stuck", not "big"
- Queries slower than `DATABASE_SLOW_QUERY_MS` (500 by default) log the
  statement, never the parameters — those carry customer PII
- `SIGTERM` drains the pool, so a rolling deploy does not sever in-flight work

A pool-level `error` event — an idle client dying during a failover — is logged
rather than left unhandled, because an unhandled `error` on an EventEmitter
terminates the process. The pool replaces the client on the next checkout.

---

## 5. Type parsing

Deliberate, because the defaults would have changed behaviour silently:

| Type | Delivered as | Why |
| --- | --- | --- |
| `numeric` | number | Ratios, multipliers and scores; money is integer cents in `*_cents` columns. Strings here would turn arithmetic into concatenation on paths no test would flag |
| `int8` | number when safe, else string | Counts and cent amounts are far inside a double's exact range |
| `timestamptz` / `timestamp` | ISO string | Every consumer either passes them to JSON or calls `new Date()`; one representation, chosen deliberately |
| `date` | `YYYY-MM-DD` | Birthdays and period boundaries have no time |

---

## 6. Verifying it yourself

```bash
pnpm db:up && pnpm db:reset      # a fresh database, built from this repo alone
pnpm seed:demo                   # 2,660 customers, 13k ledger entries, 20 campaigns
pnpm test:integration            # 71 assertions against the real server
```

The seed's own consistency is worth checking, because inconsistent demo data is
worse than none:

```sql
-- Every account balance equals the sum of its ledger. Expect 0.
select count(*) from (
  select a.id from loyalty_accounts a
  join (select account_id, sum(amount) s from loyalty_ledger group by account_id) l
    on l.account_id = a.id
 where a.balance <> l.s) x;

-- Every customer's lifetime spend equals the sum of their purchases. Expect 0.
select count(*) from (
  select c.id from customers c
  join (select customer_id, sum(amount) s from activity_events
         where type = 'purchase' group by customer_id) e on e.customer_id = c.id
 where c.lifetime_spend <> e.s) y;
```

---

## 7. Known limitations

- **No connection pooler in front of PostgreSQL.** Fine at this scale; a
  deployment scaling past a handful of replicas should put PgBouncer in
  transaction mode between them and lower `DATABASE_POOL_MAX`.
- **`data` is `any`.** See §2.
- **No read replicas.** Analytics runs against the primary. The expensive
  functions are `stable` and the heaviest is a daily recompute, so this is a
  scaling item rather than a correctness one.
- **RLS is off.** A deliberate, documented trade — see §3 and `docs/SECURITY.md`.
