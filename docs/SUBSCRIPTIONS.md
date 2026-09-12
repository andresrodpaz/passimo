# Subscriptions and feature gating

There is no free tier. Every plan is paid: **$29 / $59 / $99** a month.

[`PRICING.md`](PRICING.md) is why those numbers. This is how they are enforced.
[`BILLING.md`](BILLING.md) is the money moving.

---

## 1. No free plan, and what that means precisely

A loyalty program that costs nothing is worth nothing to its owner. It never gets
set up, never gets scanned, and churns silently — and the merchant blames the
product rather than their own lack of commitment.

The catalogue therefore contains no `free`, no `$0` and no permanent unpaid tier.
What it does contain is a **14-day trial on Growth**, which is a different thing
and is modelled as one: a trialling workspace has a real tier's entitlements for a
fortnight and then either starts paying or lapses. `tests/unit/billing.test.ts`
asserts every purchasable tier has a price greater than zero, and
`tests/e2e/commerce.spec.ts` asserts no `$0` and no card named "Free" appears on
the pricing page.

---

## 2. The catalogue

Defined once, in [`lib/billing/plans.ts`](../lib/billing/plans.ts), and read by
the pricing page, the checkout session, the entitlement checks in the API, the
usage meters in the dashboard, the upgrade prompts, the structured data and the
admin console. A tier's value is described in exactly one place, so the marketing
site can never promise something the API refuses to do.

| | Starter | Growth | Pro |
| --- | --- | --- | --- |
| **Monthly** | **$29** | **$59** | **$99** |
| Yearly | $290 | $590 | $990 |
| Customers | 500 | 5,000 | 20,000 |
| Locations | 1 | 3 | 10 |
| Team members | 3 | 10 | 25 |
| Messages / month | 2,000 | 15,000 | 50,000 |
| AI generations / month | 25 | 300 | 1,500 |
| Campaign sends / month | 10 | 50 | Unlimited |
| Proximity campaigns | — | 15 | 50 |
| Automation rules | — | 20 | 100 |

Yearly is ten months' price — two months free, 17% on every tier.

### Features by tier

| Feature | Starter | Growth | Pro |
| --- | :--: | :--: | :--: |
| `custom_branding` | ● | ● | ● |
| `wallet_proximity` | ● | ● | ● |
| `campaigns` | ● | ● | ● |
| `automations` | ● | ● | ● |
| `segments` | ● | ● | ● |
| `ai` | ● | ● | ● |
| `multi_location` | | ● | ● |
| `geofencing` | | ● | ● |
| `proximity_campaigns` | | ● | ● |
| `automation_rules` | | ● | ● |
| `gift_cards` | | ● | ● |
| `advanced_analytics` | | ● | ● |
| `memberships` | | | ● |
| `coalition` | | | ● |
| `priority_support` | | | ● |

Starter is the complete core loyalty product: wallet passes in both wallets, the
card designer, the brand kit, the scanner, campaigns, automations, segments and a
real AI allowance. What the higher tiers sell is **scale** and **advanced
capability**, not the basics. That is the load-bearing decision of the whole
model, and §3 turns it into tests.

Starter deliberately includes `wallet_proximity` — location-aware passes on the
lock screen — but not `geofencing`. The pass surfaces when a customer is near the
shop; the merchant cannot yet configure entry/exit/dwell triggers or schedule
proximity pushes. That is the clearest upgrade story in the product: they see the
feature working, then want control of it.

`priority_support` is an operational commitment (a named contact, a
same-business-day first response) rather than a code path. It carries a flag so
it can appear on a pricing card and in support tooling; nothing in the API checks
it, and nothing should.

---

## 3. Four invariants, asserted by tests

`tests/unit/billing.test.ts` enforces all four:

1. **No feature is ever removed as the plan gets more expensive.** A merchant who
   upgrades must never lose something they had. This is the easiest mistake to
   make editing the catalogue by hand.
2. **No limit is ever lowered.** Same reason.
3. **A cap is zero if and only if the plan lacks the feature.** Both halves. A
   plan that grants a feature and caps it at zero shows a working screen and then
   refuses the click with a quota error; a plan that caps a feature it does not
   grant is the mirror image, and it shipped — Starter once carried
   `proximity_campaigns: 2` without the feature, so the billing meter read
   "0 / 2" beside a screen answering "available from Growth".
4. **Every metered resource is capped.** `null` on messages or AI actions is a
   promise of unlimited provider spend against a fixed subscription.

Two more, asserted in `tests/integration/entitlements.test.ts` against real rows:

- **Starter really has the core product.** Six features checked through the
  resolver, not the catalogue. If any becomes false, Starter has quietly turned
  into a teaser and the pricing page has started lying.
- **Every refusal names a plan that would actually allow the call** — or `null`
  when nothing in the catalogue would, which is the honest answer for a request
  beyond Pro's caps.

---

## 4. `lapsed` — the state, not a tier

`PLAN_IDS` includes `lapsed`, which is **not for sale**. It is where a workspace
lands when a trial ends without a card, or a subscription is cancelled.

In that state:

- **Reads work.** Every customer, card, campaign and location is still there and
  still visible. `getEntitlements()` sets `lapsed: true` and the dashboard renders
  a reactivation banner that says so *before* it asks for money.
- **Writes are refused** with 402 and one remedy, because `lapsed` has no features
  and zero limits.
- **A POS scan still works.** An existing customer standing at the counter always
  gets their stamp — see the soft-limit rule in §6.
- **Nothing is deleted.** Ever.

Modelling it as a tier rather than a boolean means the existing entitlement
machinery gates it correctly without a single special case: `requireFeature` and
`requireWithinLimit` already refuse a plan that lacks the feature or the
allowance.

`lowestPlanWith()` and `lowestPlanWithLimit()` skip non-purchasable plans, so a
blocked merchant is never offered `lapsed` as the remedy — a plan that would
unblock nothing.

### Legacy identifiers

Three generations of catalogue have written to `businesses.plan`. Migration
`000024_pricing_v2.sql` rewrites the rows, but `normalizePlanId()` also maps them
in code, so a deploy cannot gate a paying customer during the window before the
migration runs:

| Stored | Resolves to | Why |
| --- | --- | --- |
| `free` | `lapsed` | Predates the paid-only catalogue. |
| `enterprise` | `pro` | Renamed to `business`, then folded into Pro. |
| `business` | `pro` | The fourth tier at $99; Pro is that same $99. |
| `trial` | `TRIAL_PLAN` while live, `lapsed` after | A lifecycle state, not a tier. |

---

## 5. How gating works

One gate, three call sites.

### Server: `lib/billing/entitlements.ts`

```ts
await requireFeature(businessId, 'geofencing')          // 402 if the plan lacks it
await requireWithinLimit(businessId, 'locations')       // 402 if adding would exceed
await requireWithinLimit(businessId, 'customers', 900)  // …or adding 900 would
await meterAction(businessId, 'ai_actions', 1, work)    // check → act → count
```

Or declaratively, on the route:

```ts
export const POST = defineRoute(
  { name: 'wallet.campaigns.create', feature: 'proximity_campaigns', /* … */ },
  async ({ body, business }) => { /* … */ }
)
```

`defineRoute` runs the plan check **after** the permission check, so a viewer on
Pro is told about their role and an owner on Starter is told about their plan —
never the wrong one.

### Client: `lib/client/workspace.tsx`

```ts
const { can, has } = useWorkspace()
can('wallet:write')   // role: "is my account allowed to do this?"
has('geofencing')     // plan: "does this workspace pay for this?"
```

Deliberately two functions. Role and plan fail for different reasons and deserve
different UI: a viewer who cannot send campaigns needs their manager, an owner on
Starter needs a checkout page. Collapsing them into one `isAllowed` is how
products end up showing "upgrade" to someone whose company already pays.

`has()` is optimistic while `/me` is in flight — showing a locked screen for a
fraction of a second to a paying customer is the worse failure.

**The client gate is a courtesy, never a control.** Every one of these has a
server-side counterpart, and `tests/e2e/demo-plans.spec.ts` checks the DOM half
while `tests/integration/entitlements.test.ts` checks the enforcing half. A
forged plan in the body, the query string, a header or an extra cookie changes
nothing: the resolver reads `businesses.plan` for the session's own workspace and
nothing else.

### UI: `components/billing/upgrade.tsx`

`<UpgradePrompt feature="geofencing" />` for a missing capability,
`<UpgradePrompt limit="locations" used={3} allowed={1} />` for a cap.

A cap and a missing feature read differently on purpose: "You have 1 of 1
locations" is a different sentence from "Geofencing is on Growth", and collapsing
them is how a merchant ends up unable to tell whether they need a bigger plan or a
different one.

---

## 6. Four rules the implementation encodes

1. **Billing never breaks the product.** If Stripe is unconfigured or the usage
   table is unreachable, the merchant keeps working. A failed limit lookup logs
   and allows — losing a sale to our own outage is worse than letting someone
   exceed a quota by a few hundred rows.
2. **Reads are never gated.** A downgrade must never hide data a merchant already
   has. Exceeding the customer limit stops *adding* customers; it never hides the
   existing ones, and it never stops a POS scan.
3. **Every refusal names its remedy.** A blocked call returns the cheapest plan
   that would have allowed it, so the UI renders one button. When nothing would,
   it returns `null` and the UI says so instead of offering a plan that would
   refuse the same call.
4. **Caps count what is *switched on*, not what was drafted.** A merchant
   experimenting with twenty proximity campaigns and running two is inside a
   two-campaign plan. Charging for drafts teaches people to delete their own work.
   Likewise, only *activating* consumes the cap — pausing is always allowed, so a
   merchant over their limit after a downgrade can still turn things off.

### Hard and soft, and which is which

Rule 2 has an edge that matters commercially, so it is a rule of its own: **who is
acting?**

A **hard** limit is right when the *merchant* is acting — importing a list, adding
a location, sending a campaign. They chose to do it, they can choose the plan that
allows it, and refusing costs them nothing they had a moment ago.

A **soft** limit is right when *their customer* is acting. Refusing an enrolment
at the counter costs the merchant a real, immediate sale in order to sell them an
upgrade. That trade never favours us; a merchant who watched us embarrass them in
front of a customer churns. So the overage happens, and
`lib/billing/soft-limit.ts` tells the owner — once a day, not once a scan — and
records the overage so the billing screen can explain it.

| Path | Kind |
| --- | --- |
| `POST /api/v1/customers` (merchant adds one) | hard |
| `POST /api/v1/customers/import` (merchant imports a file) | hard |
| `POST /api/v1/public/join` (customer signs themselves up) | **soft** |
| POS scan, earn, redeem | never gated |
| Transactional messages ("your reward is ready") | never gated |
| Marketing messages | hard, at `messages_per_month` |

---

## 7. Where each cap is enforced

| Cap | Call site |
| --- | --- |
| `customers` | `POST /api/v1/customers`; `POST /api/v1/customers/import` (file size, then per-chunk headroom in `lib/customers/import.ts`); soft at `POST /api/v1/public/join` |
| `locations` | `POST /api/v1/locations` |
| `messages_per_month` | reserved as `reach × channels` at `POST /api/v1/campaigns/[id]/send`; checked per marketing send in `lib/messaging/dispatch.ts` |
| `ai_actions_per_month` | `meterAction` in `POST /api/v1/ai` and in the `ai.generate_insights` job |
| `campaigns_per_month` | `POST /api/v1/campaigns/[id]/send` |
| `proximity_campaigns` | `POST`/`PATCH /api/v1/wallet/campaigns`, counting active rows |
| `automation_rules` | `POST`/`PATCH /api/v1/wallet/rules`, counting active rows |
| `team_members` | measured and displayed only — see below |

**`team_members` has no write path.** Seats are counted, displayed in the usage
meters and capped in the catalogue, but there is no invite endpoint and no team
screen, so the only team member a workspace can create is the owner at signup. The
cap is correct and currently unreachable. Recorded honestly in
`PRICING_AUDIT.md` rather than presented as enforcement.

### The import cap, in detail

Worth its own note because the obvious implementation is wrong. Checking
`used + rows.length` would refuse a merchant with 400 customers re-importing their
own 400-row list — imports update rather than duplicate, so most of those rows
create nothing. Checking nothing would let two such files put a $29 plan at 800.

So it is two checks. The route refuses a file with more rows than the whole plan
allows, which cannot fit under any interpretation and deserves one clear answer
before anything is queued. The worker then measures live headroom once per chunk
and spends it only on enrolments that come back `is_new` — updates are free, which
is both correct and what a merchant expects from a re-import. Rows that do not fit
are reported as `limited` rather than `skipped`, because "your plan is full" and
"your file is malformed" need different sentences.

---

## 8. The trial

```ts
TRIAL_PLAN         = 'growth'   // what a trialling business gets
TRIAL_EXPIRED_PLAN = 'lapsed'   // where it lands with no card
DEFAULT_TRIAL_DAYS = 14
```

Trials get **Growth**, the plan we most want merchants to buy, so the fortnight is
spent inside the product actually being sold and the day-15 question is "keep
this?" rather than "which of three things was I using?". A trial has no card on
file, and Growth's allowances are generous enough that nobody reaches them in two
weeks while being small enough that a scripted signup cannot run up a bill. The
full reasoning is in [`PRICING.md`](PRICING.md) §5.

Every screen that mentions the trial names the tier. The banner used to say
"everything unlocked", which stopped being true the moment trials moved off the
top tier — and a merchant who discovers on day three that memberships were never
included has been misled by us, not by Stripe.

An active subscription supersedes any remaining trial date — otherwise someone who
just paid would be shown "3 days left".

### After the trial

| Outcome | State |
| --- | --- |
| Card added, payment succeeds | `active` on the tier they bought |
| Card added, payment fails | `past_due` — plan kept through Stripe's dunning window |
| No card | `lapsed` — reads work, writes refused, nothing deleted |

An expired trial is **not** a free plan. `resolveEntitlements` gives it zero
features and zero allowances, so every write meets a 402 naming Starter. The
integration suite asserts that a customer enrolled during the trial is still
readable afterwards, because that is the promise the reactivation wall makes.

---

## 9. Downgrade and cancellation

**A downgrade never deletes anything.** A merchant moving from Growth to Starter
with three shops keeps all three: they stay in the table, they stay visible, they
keep working. What changes is that adding a fourth is refused. Archiving a
location frees its slot, so the way back down is to archive rather than to delete
— and `tests/integration/entitlements.test.ts` asserts both halves.

The billing screen holds the conversation *before* the click. It reads live usage
against the next plan down and lists exactly which resources would go over,
alongside the reassurance that over-cap means read-only rather than gone. A café
with one location and forty customers never sees that paragraph, because it cannot
happen to them.

**Cancellation** runs the plan to the end of the paid period, then lapses the
workspace. The billing screen states, in the order people ask: when access ends,
that customers and history are kept, that wallet passes stay on phones but stop
updating, that the dashboard stays readable, and that reactivating is one click.
The cancel action itself is Stripe's portal, which owns the confirmation, the
proration and the receipt.

---

## 10. Stripe

The plan *shape* lives in code; only the price ids are deployment configuration,
because they differ between test and live mode.

```
STRIPE_PRICE_STARTER_MONTHLY / _YEARLY
STRIPE_PRICE_GROWTH_MONTHLY  / _YEARLY
STRIPE_PRICE_PRO_MONTHLY     / _YEARLY
```

A plan with no price id configured is shown on the billing screen but cannot be
checked out. Without `STRIPE_SECRET_KEY` the billing screen reports "not
configured" and the loyalty product works unchanged.

`planFrom()` resolves the tier from subscription metadata first, then by matching
the price id against the environment — iterating `PUBLIC_PLANS` rather than a
hand-written list, so a pricing change cannot leave a real subscription resolving
to `lapsed`. See [`BILLING.md`](BILLING.md) for the webhook, idempotency and
dunning.

---

## 11. Platform administration

`/admin` (see `lib/auth/platform-admin.ts`). Plans are **visible and assignable
but not editable**: what a tier includes is code, so changing it is a deploy. That
is the right blast radius for a decision affecting every merchant at once, and an
admin screen that could rewrite the catalogue at runtime would make the
entitlement system unauditable.

Support can change a business's plan — to extend a trial, or to fix a failed
webhook — and **a reason is mandatory**. The change is written to the *merchant's*
own audit log, not only ours: they are entitled to see that support changed their
plan, and why.

MRR is derived from the catalogue rather than from a second copy of the prices,
and a yearly subscriber contributes their annual price over twelve. Trials are
excluded, because a trial has no invoice behind it.

---

## 12. Adding a plan or a feature

**A feature:**

1. Add it to `FEATURES` in `lib/billing/plans.ts`. **Only if it exists** — the
   catalogue once sold `sso`, `api_access`, `webhooks` and `team_management`, none
   of which was implemented anywhere.
2. Add a label to `FEATURE_LABEL_KEYS` in both dictionaries (the test asserts every
   feature has one, and the i18n test asserts the Spanish value is not the English
   one).
3. Grant it to the tiers that should have it — monotonically, or the invariant test
   fails.
4. Gate it: `feature: 'x'` on the route, `has('x')` in the UI. A feature nothing
   checks is a promise, not a product.
5. If it has a matching cap, set that cap to zero on every tier that lacks the
   feature — invariant 3.

**A plan:**

1. Add the id to `PLAN_IDS` and `PLAN_ORDER`, in price order.
2. Add the definition. Features and limits must not regress against the tier below.
3. Add `STRIPE_PRICE_<ID>_MONTHLY` / `_YEARLY` to `.env.example`.
4. Write a migration: `businesses_plan_check` names the tiers, and so does
   `passimo_platform_overview`'s MRR arithmetic.
5. Update `scripts/db/004_subscriptions.sql`, whose inline catalogue is the check
   that the database and the code agree.

`pnpm test` will tell you if the catalogue is inconsistent before anything ships.
`pnpm test:integration` will tell you if the enforcement is.
