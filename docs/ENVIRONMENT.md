# Environment variables

`.env.example` is the annotated source of truth. This document answers the two
questions it cannot: **what breaks without each one**, and **which are secrets**.

The governing rule: environment variables hold credentials, certificates and
infrastructure. Everything about business behaviour — locations, geofence
radiuses, campaign copy, automation rules, notification content — is configured
by the merchant in the dashboard and stored in the database. Nothing here needs
to change after deployment to alter how the product behaves for a merchant.

---

## How they are read

`lib/env.ts` is the only place `process.env` is touched on the server, and
nothing in it is read at module scope. That is deliberate and load-bearing:

- A **production build succeeds with no variables set at all** — asserted by the
  `build` job in CI. A missing integration must never break a deployment.
- A missing *required* variable fails on the first request that needs it, with an
  actionable message naming the variable and how to generate it.
- A missing *optional* variable returns `null`, and the feature reports itself as
  "not configured" in Settings rather than throwing.

`capabilityReport()` is the machine-readable version of that, surfaced at
`GET /api/v1/health?detail=1`. It reports booleans only, never values.

---

## Required

Four. Everything else is optional.

| Variable | Without it |
| --- | --- |
| `DATABASE_URL` | Nothing works. Every request that touches data fails with a message naming the variable and the `pnpm db:up` recipe. |
| `NEXT_PUBLIC_APP_URL` | Every *generated* URL is wrong — reset links, confirmation links, customer card links, wallet pass callbacks, QR targets, canonical tags, Open Graph, the sitemap, outbound webhooks. Falls back to `http://localhost:3000`, which is right locally and silently broken anywhere else. |
| `APP_TOKEN_SECRET` | Wallet passes, card links, unsubscribe links, survey links and signed downloads all fail to issue. |
| `AUTH_SESSION_SECRET` | Falls back to `APP_TOKEN_SECRET`. With neither, sign-in fails and middleware treats everyone as signed out. |

### `NEXT_PUBLIC_APP_URL` and passimo.app

`https://passimo.app` is the **future** production domain. It is not purchased or
connected, and setting it now would generate links that do not resolve — reset
emails leading nowhere, wallet passes calling a dead host.

Keep it as the platform hostname until DNS and TLS exist, then change this one
variable and redeploy. `docs/RAILWAY.md` §4 has the sequence.

---

## Secrets, and what rotating them costs

| Variable | Rotation cost |
| --- | --- |
| `AUTH_SESSION_SECRET` | Signs out every merchant on every device. This is the emergency control. |
| `APP_TOKEN_SECRET` | Invalidates every outstanding wallet pass, card link, unsubscribe link and signed download. Customers must re-add their pass. |
| `CRON_SECRET` | Scheduled jobs stop until the scheduler is updated. Nothing else notices, which is the danger. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Checkout and webhook processing stop. Billing state is server-authoritative, so nothing is lost — it stops updating. |
| `APPLE_SIGNER_KEY_PEM` etc. | New passes cannot be signed. Existing installed passes keep working until they need updating. |
| `RESEND_API_KEY`, `TWILIO_*`, `WHATSAPP_*` | That channel reports "not configured". Nothing queues up forever — `dispatchMessage` records a skip reason. |

Separate `AUTH_SESSION_SECRET` from `APP_TOKEN_SECRET` in production. Sharing
them means rotating link signatures signs everybody out as a side effect.

Generate:

```bash
openssl rand -base64 48   # APP_TOKEN_SECRET, AUTH_SESSION_SECRET
openssl rand -hex 32      # CRON_SECRET
```

---

## Which features each optional group unlocks

| Group | Unlocks | Absent |
| --- | --- | --- |
| `RESEND_*` | Transactional and campaign email; password reset and confirmation delivery | Reset links logged in development, reported undeliverable in production. The loyalty product is unaffected. |
| `TWILIO_*` | SMS campaigns | The channel is unavailable; campaigns using it record a skip reason |
| `WHATSAPP_*` | WhatsApp campaigns | As above |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` | Web push | Silent, reported in Settings |
| `APPLE_*` | Apple Wallet passes and APNs pass updates | `/api/v1/wallet/apple/*` answers 503 with an actionable message. Google passes and the browser card still work. |
| `GOOGLE_WALLET_*` | Google Wallet passes | As above, inverted |
| `GOOGLE_MAPS_API_KEY` | Address → coordinates | A merchant types latitude and longitude by hand; **every proximity feature still works** |
| `ANTHROPIC_API_KEY` | Churn explanations, campaign drafting, reward suggestions | Those screens say so explicitly rather than showing invented output |
| `STRIPE_*` | Subscription billing, the gift card shop, merchant referral credit | All three report "not configured". The loyalty product works without them. |
| `STORAGE_S3_*` | S3-compatible object storage | Falls back to local disk — correct with a persistent volume, wrong without one |

---

## Aliases, and why they exist

Several variables accept more than one name. Each is a real deployment shape, not
a fallback:

- **`APPLE_*_PEM` or `APPLE_*_PATH`.** Railway and Fly hold secrets as
  environment values; Docker and Kubernetes mount them as files. Supporting only
  inline PEM would force an operator to inline a mounted secret by hand, which is
  how private keys end up in shell history.
- **`GOOGLE_WALLET_SERVICE_ACCOUNT_JSON` or the two fields from it.** The Cloud
  console downloads a JSON blob; only `client_email` and `private_key` are used.
  Both shapes work so nobody has to reformat a secret to satisfy us.
- **`APPLE_TEAM_ID` or `APPLE_TEAM_IDENTIFIER`.** The first is documented; the
  second is accepted because earlier deployments used it, and silently breaking
  their passes on upgrade is not an acceptable trade.
- **`GOOGLE_MAPS_API_KEY`** is the fallback for `GOOGLE_GEOCODING_API_KEY` and
  `GOOGLE_PLACES_API_KEY`, because most Google projects issue a key per product
  and demanding three copies of the same value is pointless.

---

## Tuning

| Variable | Default | Raise it when |
| --- | --- | --- |
| `DATABASE_POOL_MAX` | 10 | Never, without a pooler. Ten per process against a 100-connection database already assumes only a handful of replicas. |
| `DATABASE_STATEMENT_TIMEOUT_MS` | 30000 | Above the slowest legitimate statement. A timeout should mean "stuck", not "big". |
| `DATABASE_SLOW_QUERY_MS` | 500 | Lowering it is how you find the next N+1. |
| `WORKER_BATCH_SIZE` | 50 | Queue depth in `health?detail=1` only grows. |
| `CAMPAIGN_BATCH_SIZE` | 200 | Rarely. Larger batches mean coarser retry granularity. |
| `MAX_IMPORT_ROWS` | 20000 | A merchant migrating from a system with a bigger list. |
| `LOG_LEVEL` | `info` | `debug` while diagnosing; it is noisy. |

`GOOGLE_GEOFENCING_ENABLED=false` is a deployment-level kill switch for **all**
geofence evaluation — for an operator stopping location processing platform-wide
during an incident. Merchant-level toggles live in the dashboard
(`wallet_settings`), which is where behaviour belongs.

---

## Development

`.env` and `.env.local` are both git-ignored and both loaded (`.env.local` wins).
The committed `.env.example` contains no real values.

The demo variables are development-only:

| Variable | Purpose |
| --- | --- |
| `DEMO_PASSWORD` | The password `pnpm seed:demo` sets on every demo account. Must be at least 10 characters — the seed enforces the same rule real accounts follow. |
| `PLATFORM_ADMIN_EMAILS` | Comma-separated addresses the seed promotes to platform admin |

`pnpm seed:demo` refuses to run when `NEXT_PUBLIC_APP_URL` is not a development
host. `--i-know-what-i-am-doing` overrides it, and should not be used.
