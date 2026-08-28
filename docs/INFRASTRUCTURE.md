# Infrastructure

What runs where, and the two decisions a deployment actually has to make.

---

## 1. The shape

```
Development
  localhost:3000  (pnpm dev)
        │
        └── PostgreSQL 16   docker-compose.yml, port 5433
        └── .uploads/       local disk

Future production
  passimo.app  ──DNS──▶  Railway
                            │
                            ├── web service      the Dockerfile in this repo
                            ├── PostgreSQL       Railway's database service
                            └── object storage   a volume, or an S3 bucket
```

**passimo.app is not purchased or connected.** Nothing in the codebase assumes
it exists; the domain appears only as an example in `.env.example` and as the
default `VAPID_SUBJECT` mailto. See `docs/RAILWAY.md` for the steps that connect
it when it does.

Three processes, all from the same image:

| Process | Command | Why separate |
| --- | --- | --- |
| web | `node server.js` | Serves requests |
| queue worker | `POST /api/v1/jobs/run` every minute | Campaign sends, wallet pushes, webhooks, imports and AI generation are enqueued, never done in a request. A 20,000-person campaign is 100 batch jobs, not one timeout. |
| daily cron | `POST /api/v1/cron/daily` at 03:00 | Time-based automations, stats recompute, balance expiry, membership renewals, scheduled gift cards, AI insights |

Both scheduled endpoints authenticate with `x-cron-secret: $CRON_SECRET`. They
can be Railway cron services, a GitHub Actions schedule, or any HTTP scheduler —
nothing about them is Railway-specific.

---

## 2. Decision one: where objects live

`STORAGE_DRIVER` is `local` or `s3`. This is the decision most likely to be got
wrong quietly, so the trade-off is stated rather than defaulted past.

### `local` (the default)

Writes to `STORAGE_LOCAL_DIR` (`.uploads`). Correct in development — uploads work
with no accounts, no keys and no network — and correct in production **when the
platform provides a persistent volume**. Railway does. This product's entire
object corpus is a few hundred merchant logos and campaign images, and for that a
mounted disk is simpler and cheaper than an object store.

It is **wrong** on an ephemeral filesystem or with more than one replica: each
container would hold a different subset of the files, so a logo uploaded on one
would 404 from another and vanish on the next deploy. The `Dockerfile` declares
`VOLUME ["/app/.uploads"]` to make the requirement visible.

Private objects are served through `/api/v1/files/<key>?token=…`, where the token
is an HMAC over the key and an expiry. Public objects (logos, campaign images,
which appear in emails and wallet passes where a signature could not survive) are
served without one and cached immutably.

### `s3`

Any S3-compatible bucket: AWS, Cloudflare R2, Backblaze B2, MinIO, DigitalOcean
Spaces. Signed URLs point at the bucket, so the application is not in the
download path.

SigV4 is implemented by hand (~70 lines in `lib/storage/s3.ts`) rather than by
pulling in `@aws-sdk/client-s3`. The SDK and its transitive tree add tens of
megabytes to an image whose entire need here is four HTTP verbs, and every
dependency is also a supply-chain surface. The cost is that the signing has to be
correct, which is why `tests/unit/` checks the canonical request and signing key
against AWS's published vectors.

### The default is not "whichever is configured"

An implicit fallback is how a production deployment quietly starts writing to a
container filesystem that vanishes on the next deploy. Choosing `s3` and
misconfiguring it fails loudly and is reported by
`GET /api/v1/health?detail=1`; not choosing it does not silently happen.

---

## 3. Decision two: how the schema gets applied

Migrations run **as part of starting the container**, before the server binds:

```
node --experimental-strip-types scripts/migrate.ts && exec node server.js
```

The alternative — a separate release job — means "deployed" and "schema is
current" can come apart, and the window between them is when the errors happen.
An advisory lock in the runner makes two replicas starting together safe: the
second waits, then finds nothing to do.

The trade-off is honest: a failing migration fails the deploy. That is the
intended behaviour — the previous version keeps serving — and it is why
`healthcheckPath` is set, so Railway holds traffic until the new container
reports ready.

---

## 4. Health

`GET /api/v1/health` returns 503 when PostgreSQL is unreachable. That status is
the whole point: it makes a bad release hold rather than take traffic. A process
that is running but cannot reach its database is not ready.

```bash
curl -s https://<host>/api/v1/health
# {"status":"ok","database":{"reachable":true,"latency_ms":16},…}

curl -s -H "x-cron-secret: $CRON_SECRET" 'https://<host>/api/v1/health?detail=1'
# adds: migrations applied + latest, queue depth, which integrations are
#       configured (booleans only), storage driver, uptime
```

Queue depth is in the detailed payload because a silently stalled worker is the
failure mode this architecture is most exposed to: the app keeps answering
requests perfectly while campaigns, wallet syncs and analytics recomputes pile up
unnoticed.

The unauthenticated payload is minimal on purpose. Which integrations a
deployment has configured is not much of a secret, but it is not something to
hand to anyone who asks.

---

## 5. Graceful shutdown

`SIGTERM` drains the connection pool (`lib/db/pool.ts`), so a rolling deploy does
not sever in-flight queries. `node server.js` is the container's PID 1 command
with `exec`, so the signal reaches it rather than being swallowed by a shell.

---

## 6. Scaling, and where it stops

Honest limits at the current design:

| Concern | Now | When it needs attention |
| --- | --- | --- |
| Connections | 10 per process | Past ~6 replicas against a 100-connection database. Add PgBouncer in transaction mode and lower `DATABASE_POOL_MAX`. |
| Storage | Local disk on a volume | More than one replica, or an ephemeral filesystem. Switch to `s3`. |
| Worker | One invocation a minute, 50 jobs | Sustained queue growth in `health?detail=1`. Raise `WORKER_BATCH_SIZE` or add a second worker — job claiming is `for update skip locked`, so workers do not collide. |
| Analytics | Runs on the primary | Read replicas. The heavy functions are `stable` and the heaviest is a daily recompute. |
| Rate limiting | A PostgreSQL function plus a small in-process cache | Very high volume; the counter is a row update. |

None of these are blockers for the first paying merchants. All are listed so
nobody discovers them by surprise.

---

## 7. What is deliberately *not* here

- **No Redis.** The job queue, the rate limiter and idempotency all live in
  PostgreSQL. One fewer service to run, back up and monitor, and every one of
  those needs transactional guarantees the database already provides.
- **No message broker.** Same reasoning; the outbox table is the queue.
- **No CDN requirement.** Static assets come from the platform's edge; images are
  `unoptimized` in `next.config.mjs` because merchant logos are small and already
  compressed.
- **No vendor SDK for the database.** `DATABASE_URL` is the whole coupling.
