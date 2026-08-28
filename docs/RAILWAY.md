# Deploying to Railway

Railway is the intended production host. Nothing in the application depends on
it: the same image runs under `docker compose --profile app up`, and the only
platform-specific files are `railway.json` and a few variable names.

Status: **prepared, not deployed.** The build, the start command, the health
check and the migration path are all in place and exercised locally. Nobody has
pushed this to Railway yet, and `passimo.app` is not purchased.

---

## 1. First deployment

### Create the services

1. New project → **Deploy from GitHub repo**. Railway reads `railway.json` and
   builds with the `Dockerfile`.
2. **+ New → Database → PostgreSQL.** Railway provisions it and exposes
   `DATABASE_URL` on the database service.

### Set the variables

On the **web** service:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — a reference, not a copy, so it survives a credential rotation |
| `NEXT_PUBLIC_APP_URL` | `https://<your-app>.up.railway.app` at first. **Not** `https://passimo.app` until DNS resolves — every link the product generates comes from this value, and a domain that does not resolve produces reset links, wallet callbacks and QR codes that lead nowhere. |
| `APP_TOKEN_SECRET` | `openssl rand -base64 48` |
| `AUTH_SESSION_SECRET` | `openssl rand -base64 48` — separate from the above, so rotating link signatures does not sign every merchant out |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `NODE_ENV` | `production` |

Everything else is optional. Each absent integration is reported as "not
configured" in Settings; the loyalty product works with none of them. The full
list is `.env.example` and `docs/ENVIRONMENT.md`.

### Deploy

The start command applies pending migrations and then boots:

```
node --experimental-strip-types scripts/migrate.ts && node server.js
```

Watch the deploy log for the migration output. Railway polls
`/api/v1/health` and holds traffic on the previous release until it answers 200
— which it will not do while PostgreSQL is unreachable.

### Verify

```bash
curl -s https://<host>/api/v1/health
curl -s -H "x-cron-secret: $CRON_SECRET" 'https://<host>/api/v1/health?detail=1'
```

The detailed form reports how many migrations are applied and which one is
latest. If that number is lower than the file count in `db/migrations/`, the
schema is behind the code.

**Do not run `pnpm seed:demo` against production.** It refuses when
`NEXT_PUBLIC_APP_URL` is not a development host, and that guard exists precisely
because a script that writes fake customers into a real tenant is a
data-integrity incident waiting for a mistyped environment.

---

## 2. Scheduled jobs

Two are required. Without the first, nothing asynchronous ever happens: no
campaign is sent, no wallet pass is pushed, no webhook is delivered.

| Schedule | Endpoint |
| --- | --- |
| `* * * * *` | `POST /api/v1/jobs/run` |
| `0 3 * * *` | `POST /api/v1/cron/daily` |

Either add two Railway cron services running the same image with a curl command,
or point any external scheduler at the endpoints. Both authenticate with
`x-cron-secret: $CRON_SECRET`.

```bash
curl -fsS -X POST "$APP_URL/api/v1/jobs/run" -H "x-cron-secret: $CRON_SECRET"
```

Confirm they are working by watching `jobs.pending` in `health?detail=1`. A
number that only grows means the worker is not running — the application will
look perfectly healthy while it happens, which is why that field is in the
payload.

---

## 3. Object storage

Pick one, deliberately. `docs/INFRASTRUCTURE.md` §2 has the reasoning.

**A Railway volume** (simplest): attach one mounted at `/app/.uploads` and leave
`STORAGE_DRIVER=local`. Correct for a single replica.

**An S3-compatible bucket** (required for more than one replica): set
`STORAGE_DRIVER=s3` and the `STORAGE_S3_*` variables. Cloudflare R2 has no egress
charge, which suits an image that appears in every wallet pass.

Without a volume and without S3, uploaded logos disappear on the next deploy.
The container declares the volume mount point so the requirement is visible, but
nothing can enforce it from inside.

---

## 4. Connecting passimo.app, when it exists

The application is already built for this: **no code change, only configuration.**

1. **Buy the domain.**
2. **Add it in Railway** — web service → Settings → Networking → Custom Domain.
   Railway issues the CNAME target and provisions TLS.
3. **Point DNS** at that target. Wait for propagation and confirm TLS with
   `curl -I https://passimo.app`.
4. **Set `NEXT_PUBLIC_APP_URL=https://passimo.app`** and redeploy. This is the
   step that switches every generated URL over: reset and confirmation links,
   customer card links, wallet pass web service callbacks, QR targets, canonical
   tags, Open Graph, the sitemap and outbound webhooks.
5. **Update the external callbacks** that hold the old URL:
   - Stripe webhook endpoint → `https://passimo.app/api/v1/billing/webhook`
   - Apple Wallet: nothing to do unless `APPLE_WALLET_WEB_SERVICE_URL` is set
     explicitly — it derives from the app URL, and getting the two out of sync is
     the most common reason a pass installs and then never updates again
   - Google Wallet origins, if configured
   - Any merchant integration pointing at the old hostname
6. **Re-check** `/api/v1/health`, then sign in, request a password reset and open
   the link. That one flow exercises the app URL, email delivery and the session
   cookie together.

### Passes already installed on the old hostname

A wallet pass embeds its update URL at issue time. Passes created before the
switch keep calling the Railway hostname, so **keep that hostname serving** —
Railway does by default when you add a custom domain rather than replacing it. A
pass whose web service stops answering does not error visibly; it just silently
stops updating, and the customer's balance quietly goes stale.

---

## 5. Rollback

Railway keeps previous deployments; redeploy one to roll back the application.

**Migrations do not roll back.** There are no down migrations, deliberately — a
rollback of a schema change that has already accepted writes is a data-loss
decision, and a generated `drop column` is the worst way to make it. Every
migration is written to be additive and safe to apply to a live database, so an
older application version keeps working against a newer schema. If a migration
itself is wrong, roll *forward* with a new one.

---

## 6. Things that will bite

**`NEXT_PUBLIC_APP_URL` is baked into generated links, not into the build.** It
is read at request time, so changing it needs a restart but not a rebuild. It
being wrong is silent: the app works perfectly and every emailed link is broken.

**`--experimental-strip-types` needs Node 22+.** The image pins `node:22-alpine`.

**TLS to Railway PostgreSQL.** Managed providers present certificates that are
not in Node's trust store for the internal hostnames they hand out, so the pool
defaults to TLS-without-CA-verification for non-local hosts. Set
`DATABASE_SSL=verify` if you have a CA and want it checked.

**Volumes are per-service.** A volume attached to the web service is not visible
to a cron service running the same image. Nothing in the scheduled jobs writes
uploads, so this is fine — but it is the reason to reach for S3 the moment
anything else does.
