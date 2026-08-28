# Troubleshooting

Symptoms first, because that is what you have when something is wrong.

---

## Getting started

### `Missing required environment variable DATABASE_URL`

```bash
pnpm db:up          # start PostgreSQL
pnpm db:migrate     # apply the schema
```

and make sure `DATABASE_URL` is in `.env.local` or `.env`. Nothing in
`lib/env.ts` is read at module scope, so a missing variable surfaces on the first
request that needs it rather than at boot — which is why the build succeeds
without it.

### `password authentication failed for user "passimo"` — but the password is right

Something else is already listening on the port. Two PostgreSQL servers on 5432
means whichever the resolver reaches first, and a native Windows or Homebrew
install is the usual culprit.

```bash
# Windows
Get-NetTCPConnection -LocalPort 5432 -State Listen
# macOS / Linux
lsof -iTCP:5432 -sTCP:LISTEN
```

`.env.example` uses **5433** for exactly this reason. Set `POSTGRES_PORT` and the
port in `DATABASE_URL` to match.

### `Database function passimo_… does not exist`

The schema is behind the code.

```bash
pnpm db:status     # what is applied vs pending
pnpm db:migrate
```

### `Migration files changed after they were applied`

A migration was edited after it ran. That is refused on purpose: a database whose
ledger and files disagree is one nobody can reason about.

- **Locally**, if you meant to edit it: `pnpm db:reset`.
- **Anywhere else**: revert the file and add a new migration that makes the
  change. History is a ledger, not a source file.

### `relation "app_users" does not exist`

Migration `000000_identity.sql` has not run. If the database was created before
this schema existed, `pnpm db:reset` locally; in production, `pnpm db:migrate`
applies it in order.

---

## Signing in

### The login form says the credentials are wrong, and they are not

Check the account:

```sql
select email, status, failed_login_count, locked_until, email_verified_at
  from app_users where email = 'you@example.com';
```

- `locked_until` in the future → five failed attempts. Wait fifteen minutes or
  reset the password, which clears it.
- `status <> 'active'` → suspended.
- `password_hash` not starting `scrypt$` → the row was written by something other
  than `createUser`.

### Signed in, then immediately signed out again

The session cookie is being issued and then not accepted. In order of likelihood:

1. **`AUTH_SESSION_SECRET` changed.** Every existing cookie fails its signature.
   This is the intended effect of rotating it.
2. **`secure` cookie over plain http.** Only applies with `NODE_ENV=production`
   on an http origin — the browser drops the cookie silently and nothing logs an
   error. Use https, or do not set `NODE_ENV=production` locally.
3. **The session row is revoked or expired.**

```sql
select id, created_at, last_used_at, expires_at, revoked_at
  from user_sessions where user_id = '…' order by created_at desc;
```

### A password reset email never arrives

`RESEND_API_KEY` is unset. Outside production the link is logged instead:

```
auth.reset_link_development_only  url=http://localhost:3000/reset-password?token=…
```

The endpoint always reports success regardless, deliberately — reporting "no such
account" would make it a membership oracle. `GET /api/v1/health?detail=1` shows
whether email is configured at all.

### `This reset link is no longer valid`

Reset tokens are single-use and expire in an hour, and issuing a new one consumes
the outstanding ones. If two "forgot password" emails were requested, only the
newer link works.

---

## The counter

### The camera never opens

- **Not https.** `getUserMedia` requires a secure context. `localhost` counts;
  `192.168.x.x` does not. Use a tunnel or the platform hostname when testing on
  a phone.
- **Permission denied.** The browser remembers it per origin; clear it in site
  settings.
- **No camera at all** — a desktop without a webcam, or an automated browser. The
  scanner opens straight into its manual panel, which is the intended fallback:
  there is always a way to serve the person in front of you.

### A scan awards nothing

Check the earning rules for the program:

```sql
select name, trigger, award_type, award_amount, is_active, cooldown_minutes,
       min_purchase, starts_at, ends_at
  from earning_rules where business_id = '…';
```

The response itself carries a `skipped` array naming each rule that declined and
why — `trigger_mismatch`, `outside_time_window`, `cooldown`,
`location_not_eligible`, `superseded_by_higher_priority`. That is the fastest
answer to "why no bonus?".

A note on triggers: the counter sends `purchase` instead of `visit` the moment a
cashier types a ticket amount. A `visit` rule fires on both, deliberately — a
purchase is a visit with a receipt — but a `purchase` rule does *not* fire on a
bare visit, because choosing it is how a merchant says "only when they buy
something".

### The same scan counted twice

It should not: `activity_events` has a partial unique index on
`(business_id, idempotency_key)` and `passimo_record_earn` returns the original
event on a replay. If it happened, the client sent two *different* keys — the
counter generates one per interaction, so two rapid taps producing two keys is
two visits by design.

```sql
select idempotency_key, count(*) from activity_events
 where business_id = '…' group by 1 having count(*) > 1;
```

---

## Wallet

### `Apple Wallet is not configured` (503)

Expected without credentials. Requires `APPLE_TEAM_ID`,
`APPLE_PASS_TYPE_IDENTIFIER`, and the WWDR, signer certificate and signer key —
inline as `*_PEM` or as mounted `*_PATH` files. `health?detail=1` reports
`appleWallet`.

### A pass installs and then never updates

Almost always `APPLE_WALLET_WEB_SERVICE_URL` disagreeing with
`NEXT_PUBLIC_APP_URL`. It derives from the app URL by default; if it is set
explicitly and the app URL changes, they drift.

Also: a pass embeds its update URL **at issue time**. Passes created before a
domain change keep calling the old hostname, so keep that hostname serving. A
web service that stops answering does not error visibly — the pass just silently
stops updating and the balance quietly goes stale.

### Geofence notifications never fire

In order: `GOOGLE_GEOFENCING_ENABLED` (the platform kill switch),
`wallet_settings.proximity_enabled` for the business, the location's
`geofence_enabled` and radius, whether the location has coordinates at all, and
`passimo_proximity_analytics` for what the engine decided.

A location with no `lat`/`lng` has no centre, so nothing can ever trigger. That
is what the onboarding location step exists to prevent.

---

## Background work

### Campaigns are never sent; wallet passes never update

The queue is not being drained. Nothing else looks wrong — the application keeps
answering requests perfectly while work piles up, which is why queue depth is in
the health payload.

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" '<host>/api/v1/health?detail=1'
# {"jobs":{"pending":4271,"running":0,"failed":0}, …}
```

`POST /api/v1/jobs/run` must be called every minute. See `docs/RAILWAY.md` §2.

### Jobs stuck in `running`

A worker died mid-job. `passimo_requeue_stalled_jobs` returns anything running
for more than ten minutes to `pending`; the daily cron calls it.

---

## Billing

### A checkout button does nothing

`STRIPE_SECRET_KEY` is unset, or that plan has no `STRIPE_PRICE_*` configured. A
plan with no price id is shown on the billing screen but cannot be checked out —
deliberately, so the catalogue and the price list can be edited independently.

### A subscription is paid but the plan did not change

Billing state is server-authoritative and only ever changes on a webhook. Check
`STRIPE_WEBHOOK_SECRET`, that the endpoint is
`POST /api/v1/billing/webhook`, and that Stripe's dashboard shows the delivery
succeeding. Replays are idempotent (`lib/billing/webhook-idempotency.ts`), so
re-sending an event from Stripe is safe and is the fastest fix.

---

## Uploads

### A logo uploads, then 404s later — or after a deploy

`STORAGE_DRIVER=local` on an ephemeral filesystem, or with more than one replica.
Attach a persistent volume at `STORAGE_LOCAL_DIR`, or switch to
`STORAGE_DRIVER=s3`. See `docs/INFRASTRUCTURE.md` §2.

### `Storage is not configured` on an upload

`STORAGE_DRIVER=s3` with a missing bucket or credentials. The driver logs
`storage.s3_not_configured` at startup and falls back to local disk rather than
taking the application down — so uploads keep working and land somewhere they
will not survive. `health?detail=1` reports `storage: false`.

---

## Deployment

### The health check fails and the deploy will not promote

That is the design: 503 while PostgreSQL is unreachable means a bad release holds
rather than takes traffic. Check `DATABASE_URL` on the service (it should be a
`${{Postgres.DATABASE_URL}}` reference, not a copy) and the deploy log for the
migration step, which runs before the server binds.

### Every emailed link points at the wrong host

`NEXT_PUBLIC_APP_URL`. It is read at request time, so a restart is enough — no
rebuild. This failure is silent: the app works perfectly and every link is broken.

---

## Diagnostics worth knowing

```bash
pnpm db:status                                   # migration state
curl -s <host>/api/v1/health                     # readiness
curl -s -H "x-cron-secret: $S" '<host>/api/v1/health?detail=1'
pnpm verify:full                                 # typecheck, lint, unit, integration
```

Every API response carries `X-Request-Id`, and every log line for that request
carries the same `request_id`. Asking a merchant for the id from an error screen
turns "it broke this morning" into one grep.
