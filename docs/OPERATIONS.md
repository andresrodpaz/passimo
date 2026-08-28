# Operations

---

## Deploy

### 1. Database

Apply the migrations with `pnpm db:migrate`. It applies every pending file in
numeric order inside its own transaction, records a checksum, and takes an
advisory lock so two containers starting at once cannot both run them. Any
PostgreSQL 14+ server will do; see `docs/POSTGRESQL.md`.

| File | Contents |
| --- | --- |
| `000001` | Original schema (already applied on existing installs) |
| `000002` | Platform core: locations, roles, billing, audit, jobs, API keys, webhooks |
| `000003` | CRM: customer expansion, consent, tags, notes, segments, activity events |
| `000004` | Loyalty engine: programs, tiers, rules, rewards, accounts, ledger |
| `000005` | Marketing: campaigns v2, automations, messages, suppressions, AI insights |
| `000006` | Atomic loyalty functions |
| `000007` | Analytics functions |
| `000008` | Row level security |
| `000009` | Backfill of legacy data and seed |
| `000010` | Segment execution, enrolment, referrals, gift cards |
| `000011` | Wallet device registry and hot-path indexes |
| `000012` | New-business provisioning |

The migration is non-destructive: existing customers, stamps, redemptions and
referrals are all carried into the new model.

Object storage defaults to the local filesystem (`STORAGE_DRIVER=local`,
`STORAGE_LOCAL_DIR=.uploads`), which needs a persistent volume in production. For
an ephemeral filesystem or more than one replica, set `STORAGE_DRIVER=s3` and the
`STORAGE_S3_*` variables. See `docs/INFRASTRUCTURE.md`.

### 2. Application

```bash
pnpm build && pnpm start
# or
docker compose up --build
```

Vercel, Fly, Railway or a plain container all work. The build succeeds with no
optional credentials configured.

### 3. Schedules

```jsonc
// vercel.json
{
  "crons": [
    { "path": "/api/v1/jobs/run", "schedule": "* * * * *" },
    { "path": "/api/v1/cron/daily", "schedule": "0 3 * * *" }
  ]
}
```

Outside Vercel any scheduler works:

```bash
curl -fsS -X POST https://your-domain.com/api/v1/jobs/run \
     -H "x-cron-secret: $CRON_SECRET"
```

Without the minute job **nothing sends**: campaigns, automations, wallet pushes
and webhooks all drain from the queue.

---

## Integrations

### Apple Wallet

1. Create a Pass Type ID at developer.apple.com and download the signing
   certificate.
2. Export the certificate and key as PEM into `APPLE_SIGNER_CERT_PEM` and
   `APPLE_SIGNER_KEY_PEM`; add Apple's WWDR certificate as
   `APPLE_WWDR_CERT_PEM`.
3. For live updates, create an APNs auth key and set `APPLE_PUSH_KEY_P8` and
   `APPLE_PUSH_KEY_ID`. Set `APNS_PRODUCTION=true` in production.

The pass embeds `webServiceURL = $NEXT_PUBLIC_APP_URL/api/v1/wallet/apple`,
which must be publicly reachable over HTTPS — otherwise updates silently never
arrive.

### Google Wallet

1. Create an issuer account and a service account with the Wallet Object Issuer
   role.
2. Set `GOOGLE_WALLET_ISSUER_ID` and paste the service account JSON into
   `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON`.
3. Add `NEXT_PUBLIC_APP_URL` to the issuer's authorised origins. Google rejects
   the save JWT otherwise, which is a common and confusing production failure.

### Email

Resend, with a verified sending domain (SPF and DKIM). Without domain
verification, deliverability collapses regardless of content quality.

### Commerce webhooks

Point the provider at:

```
https://your-domain.com/api/v1/integrations/{provider}/webhook?business={businessId}
```

and store the provider's signing secret in the integration's `credentials`:

| Provider | Key | Value |
| --- | --- | --- |
| Stripe | `webhook_secret` | `whsec_…` |
| Shopify | `webhook_secret` | App secret |
| Square | `signature_key`, `notification_url` | From the developer console |
| WooCommerce | `webhook_secret` | Webhook secret |
| Zapier / Make / custom | `shared_secret` | Any strong random string |

### Subscription billing (Stripe)

Separate from the *commerce* webhook above: that one ingests a merchant's own
sales, this one is how we get paid.

1. Create one recurring price per purchasable plan and interval, and set the
   matching `STRIPE_PRICE_<PLAN>_<MONTHLY|YEARLY>` variable. A plan with no
   price id is still shown on the billing screen but cannot be checked out, so a
   partial rollout degrades visibly rather than 503-ing at checkout.
2. Add an endpoint at `https://your-domain.com/api/v1/billing/webhook`
   subscribed to `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `customer.subscription.resumed`, `invoice.paid` and
   `invoice.payment_failed`. Put the signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Enable the customer portal in the Stripe dashboard — cards, invoices, VAT
   details and cancellation all happen there.
4. Turn on Stripe Tax if you sell into the EU; checkout sessions request
   `automatic_tax`.

The same endpoint fulfils online gift card purchases
(`mode: payment`, `metadata.kind = gift_card`). The card is minted by the
webhook, never by the browser returning from checkout.

Leaving Stripe unconfigured is fully supported: the billing screen shows the
catalogue read-only, the public gift shop reports `enabled: false`, and every
workspace keeps whatever plan is set on its row.

---

## Runbook

**A merchant paid but is still on the old plan.**
Stripe is the only writer of subscription state. Check
`select type, processed_at, error from subscription_events order by created_at
desc limit 20`. An unprocessed row with an `error` is a handler failure — Stripe
retries automatically, and the event id is unique so a replay cannot double-
apply. A *missing* row means the webhook never arrived: check the endpoint's
delivery log in the Stripe dashboard and that `STRIPE_WEBHOOK_SECRET` matches.

**A gift card was paid for but never arrived.**
`select * from gift_cards where stripe_payment_intent_id = '…'`. If there is no
row, the `giftcard.fulfil` job has not run — check the queue. If the row exists
with `delivered_at` null and a `deliver_at` in the future, it is scheduled, not
lost. Otherwise re-enqueue `giftcard.deliver` with the card id; delivery is
guarded by `delivered_at`, so it cannot send twice.

**Memberships did not renew.**
`passimo_renew_memberships` runs from the daily cron and is safe to run by hand:
`select passimo_renew_memberships(null)`. Period grants are keyed
`membership:<id>:<period>` on the ledger, so re-running never double-credits.
A membership that lapsed while the worker was down catches up to the present
rather than renewing into the past.

**A merchant is over their plan limit.**
Expected for the soft limits — enrolment and earning are never blocked, and the
owner is notified once a day. `select * from usage_counters where period =
'overage'` lists who has outgrown their tier, which is the upsell list.

**Campaign stuck in `sending`.**
Check the worker: `select status, count(*) from jobs group by 1`. If `pending`
is growing, the minute cron is not firing. Batch jobs are idempotent, so
re-running is always safe.

**Messages skipped.**
Open the campaign; the delivery panel breaks skips down by reason. The common
ones — `no_consent`, `suppressed`, `frequency_cap`, `quiet_hours` — are all
intentional protections, not failures.

**Wallet passes not updating.**
Confirm rows exist in `wallet_registrations` for the customer. Empty means the
device never registered, which means `webServiceURL` is unreachable or the pass
was signed with mismatched certificates. Apple's own diagnostics arrive at
`POST /wallet/apple/v1/log` and are written to the application log.

**A balance looks wrong.**
Read `loyalty_ledger` for that account: it is append-only and every entry
records `balance_after`, the reason, the rule and the staff member. Correct it
with `POST /loyalty/adjust`, never with raw SQL — the invariant
`sum(remaining) == balance` must hold or FIFO expiry breaks.

**Dead jobs.**
`select * from jobs where status = 'dead'` shows the last error. Fix the cause,
then set `status = 'pending', attempts = 0` to retry.

---

## Monitoring

Logs are structured JSON with automatic secret redaction. Useful signals:

| Event | Watch for |
| --- | --- |
| `request.failed` with `status >= 500` | Any occurrence |
| `worker.tick` | `failed > 0`, or `claimed` consistently at the limit (under-provisioned) |
| `rate_limit.unavailable` | The limiter is failing open |
| `webhook.delivery_failed` | A partner integration is down |
| `jobs.failed` with `exhausted: true` | A poison job |

Queue depth is the single best health metric:

```sql
select status, type, count(*) from jobs group by 1, 2 order by 3 desc;
```

---

## Backups

Use whatever point-in-time recovery your PostgreSQL host provides (Railway
offers backups on its database service). The tables that cannot be reconstructed
from anything else are `loyalty_ledger`, `activity_events`, `customers` and
`app_users` — the last one because losing it means no merchant can sign in even
though all their data survived. Verify all four are covered by your retention
policy before launch, and test a restore: `pnpm db:reset` proves the schema
rebuilds, which is half of it.
