# Billing

How money moves, and what the product does when it does not.

[`PRICING.md`](PRICING.md) is what we charge and why. [`SUBSCRIPTIONS.md`](SUBSCRIPTIONS.md)
is how the plan is enforced once the money has arrived. This is the middle: Stripe,
checkout, the webhook, failed payments, and what a merchant is told at each step.

Prices: **Starter $29, Growth $59, Pro $99** a month, or ten months' price for a
year. No free plan.

---

## 1. Stripe is the only writer of subscription state

The checkout route never sets a plan. Stripe decides when money moved, and
believing anything else means a customer who abandons the payment sheet after the
redirect gets a free Pro account.

```
merchant clicks "Choose Growth"
  → POST /api/v1/billing/checkout        creates the Stripe customer (once) and a session
  → Stripe Checkout                      card, address, tax
  → redirect to /dashboard/billing?checkout=success
  → customer.subscription.created        ← the plan is set HERE, and only here
```

The success redirect shows an optimistic "you are all set" and says the plan can
take a few seconds to appear, because it is waiting for the webhook rather than
lying about having already applied it.

### Why the plan is not set on redirect

Three failure modes, all of which have to be safe:

- The merchant closes the tab after paying. The webhook still arrives; the plan
  still applies.
- The merchant reaches the success URL without paying (a shared link, a back
  button, a crafted request). No webhook, no plan.
- Stripe's charge succeeds and our response times out. The webhook is retried
  until we acknowledge it.

Only a provider-driven state machine is correct in all three.

---

## 2. Configuration

```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

STRIPE_PRICE_STARTER_MONTHLY / _YEARLY
STRIPE_PRICE_GROWTH_MONTHLY  / _YEARLY
STRIPE_PRICE_PRO_MONTHLY     / _YEARLY
```

Price ids are deployment configuration, not code and not database rows: the same
plan is a different id in test and live mode, and nobody should be editing that in
a settings screen. `priceIdFor(plan, interval)` derives the variable name from the
plan id, so adding a tier needs no new lookup table.

**Nothing hardcodes a price id, and no secret appears outside `lib/billing`.** A
plan with no configured price is shown on the billing screen but cannot be checked
out, because a button that 503s is worse than no button. Without
`STRIPE_SECRET_KEY` at all, the billing screen reports "not configured" and the
loyalty product works unchanged — a self-hosted deployment needs no Stripe.

### Setting it up

1. Create three products in Stripe named Starter, Growth and Pro.
2. On each, create two recurring USD prices: monthly and yearly, at the figures in
   `lib/billing/plans.ts`. Yearly is ten months' worth.
3. Paste the six `price_…` ids into the environment.
4. Add the webhook endpoint (§4) and paste its signing secret.

`STRIPE_PRICE_BUSINESS_*` used to exist. The fourth tier was folded into Pro at
the same $99 by migration `000024_pricing_v2.sql`; a subscription still sitting on
the old Business price keeps being charged whatever Stripe says, and `planFrom()`
resolves it from subscription metadata, so removing the two variables changes
nothing for an existing subscriber.

---

## 3. Checkout, portal and plan changes

`POST /api/v1/billing/checkout` — starts a subscription. Requires the
`billing:manage` permission, so a staff account cannot commit the business to a
recurring charge.

The Stripe customer is created lazily on first checkout, so a business that never
opens the billing screen never appears in Stripe. The id is written back **before**
the session is created: if the round trip fails, the retry reuses the same customer
instead of orphaning one per attempt. `createCustomer` also carries an idempotency
key of `customer:<businessId>`, so two concurrent clicks cannot produce two
customers.

**Changing plan while subscribed goes to the portal, not to checkout.** The route
detects an existing `stripe_subscription_id` and returns a portal URL instead.
Stripe owns proration, tax recalculation and the confirmation screen there, and
reimplementing any of those would mean getting them subtly wrong.

`POST /api/v1/billing/portal` — the same portal, for invoices, cards and VAT
details. Those live in Stripe deliberately: rebuilding them would mean taking on
PCI scope to reproduce a screen Stripe already does better.

### Upgrades and downgrades

| | Effect |
| --- | --- |
| Upgrade | Immediate, prorated by Stripe. The webhook raises the plan. |
| Downgrade | Immediate at Stripe's choosing; the webhook lowers the plan. **Nothing is deleted** — see `SUBSCRIPTIONS.md` §9. |
| Cancel | Runs to the end of the paid period, then `customer.subscription.deleted` lapses the workspace. |

The billing screen reads live usage against the next plan down and lists exactly
what would go over before the merchant clicks. Over-cap means read-only, never
removed.

---

## 4. The webhook

`POST /api/v1/billing/webhook`

| Event | What it does |
| --- | --- |
| `checkout.session.completed` (mode `payment`) | A gift card purchase. Handed to the commerce module. |
| `checkout.session.completed` (mode `subscription`) | Nothing. The `customer.subscription.*` event carries the authoritative status. |
| `customer.subscription.created` / `.updated` / `.resumed` | Sets plan, interval, status, period end, cancel-at-period-end. Clears any leftover trial date when active. |
| `customer.subscription.deleted` | Lapses the workspace. Downgrade, never delete. |
| `invoice.payment_failed` | `past_due`, and starts or advances the dunning sequence. |
| `invoice.paid` | `active`, and closes any open dunning sequence. |

Everything else is recorded for the audit trail and ignored.

### Signature verification

`verifyWebhook` checks the HMAC over `"<timestamp>.<rawBody>"` with
`timingSafeEqual`, **and** rejects a timestamp outside a 300-second tolerance.
Without the tolerance check a signature captured once could be replayed forever.
The raw body is read as text before any parsing, because verifying a re-serialised
JSON object verifies the wrong bytes.

### Idempotency

Stripe delivers at-least-once, so the first thing the handler does after verifying
the signature is claim the event id in `subscription_events`. The unique index on
`(provider, provider_event_id)` turns a replay into a no-op rather than a second
plan change.

Reading the insert error correctly is the whole contract, and it is wrong in both
directions:

- Treating a real database failure as a duplicate returns 200, Stripe never
  retries, and a paid upgrade silently never applies.
- Treating a duplicate as a failure returns 500, Stripe retries forever, and the
  loop cannot terminate because the row will always be there.

So it is `interpretClaim()` — a named, tested pure function over the codes Postgres
actually emits — rather than an inline `error.code === '23505'`.

| Verdict | HTTP | Stripe's behaviour |
| --- | --- | --- |
| `fresh` | 200 | Done. |
| `duplicate` | 200 | Stops retrying — the effects are already applied. |
| `unavailable` | 500 | Retries, which is what we want when *our* store failed. |

A handler that throws records the error on the event row and answers 500, so the
event is retried and the failure is visible rather than lost.

### Resolving the business

Metadata first (cheap), then the stored `stripe_customer_id` (reliable). A
subscription created outside our checkout — sales-assisted, imported — still
resolves. `planFrom()` reads the tier from subscription metadata, then falls back
to matching the price id against the environment, iterating `PUBLIC_PLANS` rather
than a hand-written list. That list used to be written out by hand and included
`business`; a missed edit there resolves a real, paid subscription to `lapsed`.

---

## 5. Failed payments

Stripe retries a failed invoice several times over roughly two weeks. Until
recently the product recorded `past_due` and said nothing, so the first a merchant
heard about a payment problem was their own workspace going quiet — both the worst
possible support experience and the most avoidable churn in the product.

Stripe owns the retries. `lib/billing/dunning.ts` owns the conversation.

| Stage | Trigger | Message |
| --- | --- | --- |
| `first` | attempt 1 failed | "We could not take payment. We will try again." |
| `retry` | attempt 2 | Same, with the next attempt date. |
| `final` | attempt 3 | "This is the last attempt." |
| `lapsed` | attempts exhausted, or `next_payment_attempt` is null | Workspace moves to `lapsed`. Nothing deleted. |
| `recovered` | `invoice.paid` | "It worked." |

Four rules the schedule encodes:

1. **Warn before, never after.** Every stage has an email, including the one that
   says "this is the last attempt".
2. **Say what is *not* happening.** Each message states plainly that nothing has
   been deleted, because the fear a payment failure produces is disproportionate
   to what actually happens.
3. **Advance on attempts, not on days.** Stripe decides when to retry, so driving
   the sequence off `attempt_count` keeps our story and their schedule in step even
   if they change the cadence. And if Stripe says it has stopped trying —
   `next_payment_attempt` is null — we act on that whatever our counter says.
   Believing our own counter over Stripe's is how a merchant gets paused while a
   retry is still pending.
4. **Recovery is a message too.** Silence after three warnings reads as "still
   broken".

`MAX_PAYMENT_ATTEMPTS = 4` matches Stripe's default of initial plus three retries.

### A delinquent subscriber keeps their plan

`resolveEntitlements` treats `past_due`, `unpaid` and `incomplete_expired` as
delinquent for display, and **does not lower the tier**. Dropping someone to
`lapsed` the hour a bank declines a card is how a customer is lost over a fraud
check. Stripe manages the grace period; we keep the lights on and keep them
informed. The dashboard shows a non-dismissible banner, because ignoring this one
costs the merchant their account.

---

## 6. Billing states, and what each means

`businesses.plan` holds the tier or a lifecycle state;
`businesses.subscription_status` holds Stripe's word for the money.

| `plan` | `subscription_status` | Merchant sees |
| --- | --- | --- |
| `starter` / `growth` / `pro` | `active` | Normal. Renewal date on the billing screen. |
| `starter` / `growth` / `pro` | `trialing` | A trial that has a card attached. Plan applies. |
| `starter` / `growth` / `pro` | `past_due` / `unpaid` | Plan applies. Non-dismissible "fix payment" banner. |
| `starter` / `growth` / `pro` | `active`, `cancel_at_period_end` | "Your plan ends on <date>", with a way to change their mind. |
| `trial` | `trialing` or null | Trial countdown. Entitled to Growth. |
| `lapsed` | `canceled` | Reactivation wall. Reads work, writes 402. |

`plan` and `effective_plan` are different fields for a reason. `plan` is the tier
being *billed* and normalises `trial` to `lapsed`; `effective_plan` is the tier
whose features apply right now, which for a live trial is Growth. Reading only
`plan` is how the admin console came to label every live trial "Inactive" and count
it as churn. Gate on `effective_plan`; use `stored_plan` to tell "trialling" from
"trial ended".

---

## 7. What is not gated by billing

Deliberately, and it is a short list worth stating:

- **POS scans, earns and redemptions.** A customer at the counter is never turned
  away because of our limit, on any plan, including `lapsed`.
- **Reads.** Every screen stays readable in every state.
- **Transactional messages.** "Your reward is ready" is the product working, not
  marketing.
- **Wallet passes already issued.** They stay on customers' phones. They stop
  updating when a workspace lapses, which is the honest consequence, but nothing
  is revoked.

---

## 8. Verifying it

| What | How |
| --- | --- |
| Catalogue consistency, prices, invariants | `pnpm test` → `tests/unit/billing.test.ts` |
| Webhook idempotency verdicts, dunning transitions | `pnpm test` → `tests/unit/billing-dunning.test.ts` |
| Enforcement against real rows | `pnpm test:integration` → `tests/integration/entitlements.test.ts` |
| The database's own view | `psql "$DATABASE_URL" -f scripts/db/004_subscriptions.sql` |
| Plan gates over HTTP, per demo account | `pnpm verify:functional` |
| The DOM half of gating | `pnpm test:e2e` → `tests/e2e/demo-plans.spec.ts` |

`scripts/db/004_subscriptions.sql` is worth singling out: it inlines the catalogue
and asserts the *column* against it, so a divergence between what the code believes
and what the database holds shows up as a FAIL rather than as a support ticket. It
also reports self-contradictory billing states — a paid tier with no Stripe
subscription behind it, a trial with no end date, a `cancel_at_period_end` with
nothing to cancel.
