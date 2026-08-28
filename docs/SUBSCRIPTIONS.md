# Subscriptions and feature gating

There is no free tier. Every plan is paid, starting at $5/month.

---

## 1. Why no free plan

A loyalty program that costs nothing is worth nothing to its owner. It never gets set
up, never gets scanned, and churns silently — and the merchant blames the product
rather than their own lack of commitment. $5 is less than two coffees, which is the
comparison a café owner actually makes, and it is enough to make someone print the QR
code.

Every tier is preceded by a 14-day trial with **everything unlocked**, so the decision
is made with evidence rather than faith.

---

## 2. The catalogue

Defined once, in `lib/billing/plans.ts`, and read by the pricing page, the checkout
session, the entitlement checks in the API, the usage meters in the dashboard, the
upgrade prompts and the admin console. A tier's value is described in exactly one
place, so the marketing site can never promise something the API refuses to do.

| | Starter | Growth | Pro | Business |
| --- | --- | --- | --- | --- |
| **Monthly** | **$5** | **$19** | **$49** | **$99** |
| Yearly | $50 | $190 | $490 | $990 |
| Customers | 500 | 5,000 | 25,000 | Unlimited |
| Locations | 1 | 5 | 15 | Unlimited |
| Team members | 2 | 10 | 25 | Unlimited |
| Messages / month | 500 | 10,000 | 50,000 | Unlimited |
| AI actions / month | — | — | 2,000 | Unlimited |
| Campaigns / month | 2 | Unlimited | Unlimited | Unlimited |
| Proximity campaigns | 1 | 10 | 50 | Unlimited |
| Automation rules | — | 10 | 50 | Unlimited |

Yearly is ten months' price — two months free.

### Features by tier

| Feature | Starter | Growth | Pro | Business |
| --- | --- | --- | --- | --- |
| `custom_branding` | ● | ● | ● | ● |
| `wallet_proximity` | ● | ● | ● | ● |
| `campaigns` | | ● | ● | ● |
| `automations` | | ● | ● | ● |
| `gift_cards` | | ● | ● | ● |
| `segments` | | ● | ● | ● |
| `multi_location` | | ● | ● | ● |
| `geofencing` | | ● | ● | ● |
| `proximity_campaigns` | | ● | ● | ● |
| `automation_rules` | | ● | ● | ● |
| `memberships` | | | ● | ● |
| `ai` | | | ● | ● |
| `advanced_analytics` | | | ● | ● |
| `api_access` | | | ● | ● |
| `webhooks` | | | ● | ● |
| `coalition` | | | | ● |
| `team_management` | | | | ● |
| `priority_support` | | | | ● |
| `sso` | | | | ● |

Starter deliberately includes `wallet_proximity` — location-aware passes on the lock
screen — but not `geofencing`. The pass surfaces when a customer is near the shop; the
merchant cannot yet configure entry/exit/dwell triggers or send campaigns. That is the
clearest upgrade story in the product: they see the feature working, then want control
of it.

### Two invariants, asserted by tests

`tests/unit/billing.test.ts` enforces both:

- **No feature is ever removed as the plan gets more expensive.** A merchant who
  upgrades must never lose something they had. This is the easiest mistake to make
  editing the catalogue by hand.
- **No limit is ever lowered.** Same reason.

---

## 3. `lapsed` — the state, not a tier

`PLAN_IDS` includes `lapsed`, which is **not for sale**. It is where a workspace lands
when a trial ends without a card, or a subscription is cancelled.

In that state:

- **Reads work.** Every customer, card, campaign and location is still there and still
  visible. `getEntitlements()` sets `lapsed: true` and the dashboard renders a
  reactivation banner that says so *before* it asks for money.
- **Writes are refused** with 402 and one remedy, because `lapsed` has no features and
  zero limits.
- **Nothing is deleted.** Ever.

Modelling it as a tier rather than a boolean means the existing entitlement machinery
gates it correctly without a single special case: `requireFeature` and
`requireWithinLimit` already refuse a plan that lacks the feature or the allowance.

`lowestPlanWith()` and `lowestPlanWithLimit()` skip non-purchasable plans, so a blocked
merchant is never offered `lapsed` as the remedy — a plan that would unblock nothing.

### Legacy identifiers

Rows written before this change say `free` or `enterprise`. Migration 15 rewrites them,
but `normalizePlanId()` also maps them in code, so a deploy cannot gate a paying
customer during the window before the migration runs:

| Stored | Resolves to |
| --- | --- |
| `free` | `lapsed` |
| `enterprise` | `business` |
| `trial` | `TRIAL_PLAN` while live, `lapsed` after |

---

## 4. How gating works

One gate, three call sites.

### Server: `lib/billing/entitlements.ts`

```ts
await requireFeature(businessId, 'geofencing')          // 402 if the plan lacks it
await requireWithinLimit(businessId, 'locations')       // 402 if adding would exceed
await meterAction(businessId, 'messages', 200, send)    // check → act → count
```

Or declaratively, on the route:

```ts
export const POST = defineRoute(
  { name: 'wallet.campaigns.create', feature: 'proximity_campaigns', /* … */ },
  async ({ body, business }) => { /* … */ }
)
```

`defineRoute` runs the plan check **after** the permission check, so a viewer on Pro is
told about their role and an owner on Starter is told about their plan — never the wrong
one.

### Client: `lib/client/workspace.tsx`

```ts
const { can, has } = useWorkspace()
can('wallet:write')   // role: "is my account allowed to do this?"
has('geofencing')     // plan: "does this workspace pay for this?"
```

Deliberately two functions. Role and plan fail for different reasons and deserve
different UI: a viewer who cannot send campaigns needs their manager, an owner on
Starter needs a checkout page. Collapsing them into one `isAllowed` is how products end
up showing "upgrade" to someone whose company already pays.

`has()` is optimistic while `/me` is in flight — showing a locked screen for a fraction
of a second to a paying customer is the worse failure.

### UI: `components/billing/upgrade.tsx`

`<UpgradePrompt feature="geofencing" />` for a missing capability,
`<UpgradePrompt limit="locations" used={3} allowed={1} />` for a cap.

A cap and a missing feature read differently on purpose: "You have 1 of 1 locations" is
a different sentence from "Geofencing is on Growth", and collapsing them is how a
merchant ends up unable to tell whether they need a bigger plan or a different one.

### Four rules the implementation encodes

1. **Billing never breaks the product.** If Stripe is unconfigured or the usage table is
   unreachable, the merchant keeps working. A failed limit lookup logs and allows —
   losing a sale to our own outage is worse than letting someone exceed a quota by a few
   hundred rows.
2. **Reads are never gated.** A downgrade must never hide data a merchant already has.
   Exceeding the customer limit stops *adding* customers; it never hides the existing
   ones, and it never stops a POS scan — a customer standing at the counter always gets
   their stamp.
3. **Every refusal names its remedy.** A blocked call returns the cheapest plan that
   would have allowed it, so the UI renders one button.
4. **Caps count what is *switched on*, not what was drafted.** A merchant experimenting
   with twenty proximity campaigns and running two is inside a two-campaign plan.
   Charging for drafts teaches people to delete their own work. Likewise, only
   *activating* consumes the cap — pausing is always allowed, so a merchant over their
   limit after a downgrade can still turn things off.

---

## 5. Stripe

The plan *shape* lives in code; only the price ids are deployment configuration,
because they differ between test and live mode.

```
STRIPE_PRICE_STARTER_MONTHLY / _YEARLY
STRIPE_PRICE_GROWTH_MONTHLY  / _YEARLY
STRIPE_PRICE_PRO_MONTHLY     / _YEARLY
STRIPE_PRICE_BUSINESS_MONTHLY / _YEARLY
```

A plan with no price id configured is shown on the billing screen but cannot be checked
out.

Webhook: `POST /api/v1/billing/webhook` —
`checkout.session.completed`, `customer.subscription.*`, `invoice.paid`,
`invoice.payment_failed`.

`planFrom()` resolves the tier from subscription metadata first, then by matching the
price id against the environment — so a subscription created outside our checkout
(sales-assisted, imported) still resolves correctly.

A **delinquent** subscriber keeps their plan through the grace period Stripe manages.
Dropping someone to `lapsed` the hour a bank declines a card is how a customer is lost
over a fraud check.

Without `STRIPE_SECRET_KEY` the billing screen reports "not configured" and the loyalty
product works unchanged.

---

## 6. The trial

```ts
TRIAL_PLAN         = 'pro'      // what a trialling business gets
TRIAL_EXPIRED_PLAN = 'lapsed'   // where it lands with no card
DEFAULT_TRIAL_DAYS = 14
```

Trials get **Pro**, not Starter. The features a merchant falls in love with should be
the ones we most want them to pay for, so the downgrade at day 14 is a real, felt loss.

An active subscription supersedes any remaining trial date — otherwise someone who just
paid would be shown "3 days left".

---

## 7. Platform administration

`/admin` (see `lib/auth/platform-admin.ts`). Plans are **visible and assignable but not
editable**: what a tier includes is code, so changing it is a deploy. That is the right
blast radius for a decision affecting every merchant at once, and an admin screen that
could rewrite the catalogue at runtime would make the entitlement system unauditable.

Support can change a business's plan — to extend a trial, or to fix a failed webhook —
and **a reason is mandatory**. The change is written to the *merchant's* own audit log,
not only ours: they are entitled to see that support changed their plan, and why.

---

## 8. Adding a plan or a feature

**A feature:**

1. Add it to `FEATURES` in `lib/billing/plans.ts`.
2. Add a label to `FEATURE_LABELS` (the test asserts every feature has one).
3. Grant it to the tiers that should have it — monotonically, or the invariant test
   fails.
4. Gate it: `feature: 'x'` on the route, `has('x')` in the UI.

**A plan:**

1. Add the id to `PLAN_IDS` and `PLAN_ORDER`, in price order.
2. Add the definition. Features and limits must not regress against the tier below.
3. Add `STRIPE_PRICE_<ID>_MONTHLY` / `_YEARLY` to `.env.example`.
4. Add it to the price-id fallback list in `app/api/v1/billing/webhook/route.ts`.

`pnpm test` will tell you if the catalogue is inconsistent before anything ships.
