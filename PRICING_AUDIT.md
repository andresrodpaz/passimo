# Passimo — pricing, subscription and monetization audit

**Date:** 7 September 2026
**Scope:** the whole monetization system — catalogue, entitlements, limits,
enforcement, billing, trial, upgrade/downgrade/cancellation, pricing UI,
localisation, demo accounts, tests and documentation.
**Outcome:** implemented. Pricing v2 is live in the codebase at **$29 / $59 / $99**.

Written to be read by somebody deciding whether to charge money with this. It is
therefore deliberately unflattering where the truth is unflattering: §17 lists
four things that are still wrong, and §16 names the one commercial risk large
enough to change a plan over.

---

## 1. Executive summary

Passimo's monetization system was well *engineered* and badly *priced*.

The engineering was already right in the ways that are hard to retrofit: one
catalogue file as the single source of truth, a single entitlement gate, a
provider-authoritative webhook with real idempotency, a dunning sequence, and a
non-purchasable `lapsed` tier modelled as a tier so the existing machinery gates
it without special cases. Almost none of that needed changing.

The pricing was wrong in four ways, and each one was load-bearing:

1. **$5 entry.** Below cost once a merchant touched marketing or AI, and it set an
   expectation that made the product disposable.
2. **Starter was not a product.** It had `custom_branding` and
   `wallet_proximity` and nothing else — no campaigns, no automations, no
   segments, no AI. A café could collect customers and not contact them.
3. **Four features were sold and did not exist.** `sso`, `api_access`,
   `webhooks` and `team_management` appeared on the top tier's card and were
   checked by no route and unlocked by no screen.
4. **Three caps were enforced by nothing.** `campaigns_per_month` was never
   checked or counted, `messages_per_month` was counted but never checked, and the
   CSV importer had no customer cap at all — so a $5 plan accepted twenty thousand
   rows in one request.

All four are fixed. The catalogue is three tiers at $29 / $59 / $99, Starter now
carries the complete core loyalty product, the phantom features are gone rather
than renamed, and every cap that costs money is enforced server-side and proven
so by tests against a real database and a running API.

**Verification, as of this writing.** Every figure below was observed, not
estimated:

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | clean |
| `pnpm lint` | clean |
| `pnpm test` (unit) | **694 passed**, 29 files |
| `pnpm test:integration` (real Postgres) | **116 passed**, 7 files |
| `pnpm test:e2e` (desktop + mobile) | **214 passed**, 0 failed, 4 skipped |
| `pnpm build` | compiled, 91 static pages |
| `pnpm verify:functional` (live production build) | **821 passed, 0 warnings, 0 failed** |
| `pnpm db:verify` | **239 pass, 0 fail, 0 error** |
| `scripts/db/004_subscriptions.sql` | all PASS |
| Adversarial HTTP probe (§12) | **19 / 19** |
| `passimo_platform_overview()` MRR on the demo seed | **$187** = $29 + $59 + $99 |

The adversarial probe is worth singling out: it confirmed that no forged plan —
in the request body, the query string, a header, or an extra cookie — changes any
answer, and that a session pointing at another tenant's workspace is refused with
403 rather than gated by plan.

**Recommendation: ship it.** With one condition, in §16: do not enable SMS or
WhatsApp before the message meter is split by channel.

---

## 2. Current pricing (before)

| | Starter | Growth | Pro | Business |
| --- | --- | --- | --- | --- |
| Monthly | $5 | $19 | $49 | $99 |
| Yearly | $50 | $190 | $490 | $990 |
| Customers | 500 | 5,000 | 25,000 | ∞ |
| Locations | 1 | 5 | 15 | ∞ |
| Team members | 2 | 10 | 25 | ∞ |
| Messages / month | 500 | 10,000 | 50,000 | ∞ |
| AI actions / month | 0 | 0 | 2,000 | ∞ |
| Campaigns / month | 0 | ∞ | ∞ | ∞ |
| Trial | 14 days on **Pro** | | | |

Starter's feature list was `['custom_branding', 'wallet_proximity']`. That is
two entries out of nineteen.

---

## 3. Final pricing (after)

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
| Trial | 14 days on **Growth** | | |

Yearly is ten months on every tier — a flat 17%, derived rather than written down,
so the badge cannot disagree with the invoice.

### Starter — $29

*"For a small business ready to build real customer loyalty."*

The complete core product. Wallet passes in Apple and Google Wallet, the card
designer, the brand kit, the QR scanner, stamps/points/tiers/rewards, customer
profiles and history, campaigns, always-on automations, saved segments, and 25 AI
generations a month. One location, 500 customers, three staff logins.

### Growth — $59

*"For a growing business ready to automate its retention."*

Everything in Starter, plus three locations with per-site reporting, geofences the
merchant defines themselves, proximity campaigns, the no-code automation rule
builder, gift cards, and advanced analytics (retention cohorts, churn risk, CLV,
campaign attribution). Ten times the customers, twelve times the AI.

Marked "Most popular" as a product recommendation. No popularity statistic is
quoted anywhere, because there is no honest one to quote.

### Pro — $99

*"For multi-location retention, memberships and deeper analytics."*

Everything in Growth, plus paid memberships as the merchant's own recurring
revenue, the partner network, ten locations, 20,000 customers, unlimited campaign
sends, 1,500 AI generations, and priority support.

**Not unlimited, deliberately.** See §16.

---

## 4. Small-business fit

The test the brief sets, answered honestly.

**A one-site café, ~200 customers, wants digital loyalty, Wallet cards, QR, and
something easy. Would they pay $29?** Yes. They get the entire product: they
design their own card with their logo and colours, print one QR code, scan
customers on the phone in their pocket, run ten campaigns a month, leave the
welcome/birthday/win-back automations running, and have the AI write the copy.
$29 is one or two covers. Nothing they need is behind a paywall, and — importantly
— nothing they *don't* need is cluttering their screen.

Before this work the honest answer was **no**: at $5 they could not send a single
campaign, and a loyalty product that cannot contact a customer is a spreadsheet
with a nicer font.

**A restaurant with three locations, needs automation, analytics, segmentation.
Would they pay $59?** Yes, and the reason is specific rather than aspirational:
Starter caps at one location, so they cannot run on it at all. Growth gives them
per-site reporting, geofences at each door, cohort retention and churn risk, gift
cards to sell, and 5,000 customers.

**A larger business, multiple locations, AI, advanced automation, deeper
analytics. Would they pay $99?** Yes, with a caveat worth stating. The multi-site
case is strong — ten locations, 20,000 customers, memberships, unlimited campaigns.
The *AI* case is thinner than the pricing page implies: the AI is real (Anthropic,
grounded in a genuine business snapshot, no mocking anywhere), but the difference
between Growth's 300 generations and Pro's 1,500 is volume rather than capability.
Pro's honest differentiators are memberships, the partner network and scale. §17
records this.

---

## 5. Feature allocation, and where each one is enforced

Every feature in the catalogue, with the code that gates it. A feature nothing
checks is a promise, not a product, and this table is the check on that.

| Feature | Tier | Enforced at |
| --- | --- | --- |
| `custom_branding` | Starter | `/api/v1/brand/*`, `/api/v1/wallet/design` |
| `wallet_proximity` | Starter | `/api/v1/wallet/settings` |
| `campaigns` | Starter | `/api/v1/campaigns`, `/api/v1/campaigns/[id]/send`, nav |
| `automations` | Starter | `/api/v1/automations`, nav |
| `segments` | Starter | `/api/v1/segments` |
| `ai` | Starter | `/api/v1/ai` |
| `multi_location` | Growth | `/api/v1/locations/import` (+ the `locations` cap) |
| `geofencing` | Growth | `/api/v1/wallet/settings`, onboarding checklist |
| `proximity_campaigns` | Growth | `/api/v1/wallet/campaigns` |
| `automation_rules` | Growth | `/api/v1/wallet/rules` |
| `gift_cards` | Growth | `/api/v1/gift-cards/*`, `/api/v1/public/gift-cards`, nav |
| `advanced_analytics` | Growth | the `ai.generate_insights` daily job |
| `memberships` | Pro | `/api/v1/memberships/*`, nav |
| `coalition` | Pro | `/api/v1/network/*`, nav |
| `priority_support` | Pro | **operational, not code** — see below |

`priority_support` is a commitment (named contact, same-business-day first
response), not a code path. It carries a flag so it can appear on a pricing card
and in support tooling. Nothing in the API checks it and nothing should.

### Removed: four features that did not exist

| Advertised as | Reality | Action |
| --- | --- | --- |
| Single sign-on | No implementation anywhere | Removed from the catalogue |
| REST API access | No implementation, no key-scoped surface | Removed |
| Webhooks | `lib/webhooks/deliver.ts` exists; nothing exposes it to a merchant | Removed |
| Team management | No invite endpoint, no team screen | Removed; seats remain governed by the `team_members` cap |

They were on the old $99 card. A merchant could have paid for four things that
were never going to arrive. `tests/unit/billing.test.ts` now asserts each of the
four names is absent from `FEATURES`, and asserts generally that every remaining
feature is sold by some purchasable plan.

---

## 6. Limits, and how each is counted

| Limit | Counted against | Kind |
| --- | --- | --- |
| `customers` | live rows, excluding anonymised | hard for merchant writes, **soft** at the public join page |
| `locations` | live rows, excluding archived | hard |
| `team_members` | active rows | measured only — **no write path exists** (§17) |
| `messages_per_month` | `usage_counters`, calendar month | hard, marketing only |
| `ai_actions_per_month` | `usage_counters` | hard |
| `campaigns_per_month` | `usage_counters`, counted on **send** | hard |
| `proximity_campaigns` | **active** rows only | hard |
| `automation_rules` | **active** rows only | hard |

Two design rules worth stating because they are the difference between a limit
that sells an upgrade and one that loses a merchant.

**Caps count what is switched on, not what was drafted.** A merchant
experimenting with twenty proximity campaigns and running two is inside a
two-campaign plan. Charging for drafts teaches people to delete their own work,
and pausing must always be allowed so a merchant over their cap after a downgrade
can get back under it.

**Who is acting decides hard versus soft.** A hard limit is right when the
merchant is acting — importing, adding a site, sending. A soft one is right when
*their customer* is acting: refusing an enrolment at the counter costs the
merchant a real sale to make us a hypothetical one, and a merchant who watched us
embarrass them in front of a customer churns. So the public join page overshoots
and we tell the owner once a day instead.

### Gaps closed in this pass

| Gap | Before | After |
| --- | --- | --- |
| Campaign sends | cap defined, **never checked or counted** | reserved and counted on send |
| Marketing messages | counted after each send, **never checked** | `reach × channels` reserved before queueing; per-send check in `dispatchMessage` |
| CSV import | **no customer cap at all** | file-size refusal at the route, per-chunk live headroom in the worker |
| Daily AI insights | ran for **every** workspace, ungated and unmetered | gated on `advanced_analytics`, metered against the AI allowance |
| Starter's phantom caps | `proximity_campaigns: 2` without the feature | zero, with a test asserting cap-zero ⇔ feature-absent |

The import fix deserves its detail, because the obvious implementation is wrong.
Checking `used + rows.length` would refuse a merchant with 400 customers
re-importing their own 400-row list — imports update rather than duplicate, so
most of those rows create nothing. Checking nothing lets two such files put a $29
plan at 800. So it is two checks: the route refuses a file larger than the whole
plan (which cannot fit under any reading), and the worker measures live headroom
per chunk and spends it only on rows that come back `is_new`. Rows that do not fit
are reported as `limited` rather than `skipped`, because "your plan is full" and
"your file is malformed" need different sentences.

---

## 7. Wallet strategy

**The wallet card is the product, so none of it is gated.**

Starter gets: passes in Apple Wallet and Google Wallet, the full card designer
(eleven templates, card style, colours, progress display, what the card shows, the
back of the card), the brand kit (logo, primary/secondary/accent colours, business
name, description, contact details), QR and barcode, and `wallet_proximity` — the
pass surfacing on the lock screen when a customer is near the shop.

What Growth adds is **control, not access**: geofences the merchant defines with
entry/exit/dwell triggers, and proximity campaigns they schedule. A Starter
merchant sees the feature working before being asked to pay for control of it,
which is the clearest upgrade story in the product.

"Change my logo" and "change my brand colours" behind a paywall would have made
Starter a trial with a price on it. `tests/unit/billing.test.ts` and
`tests/unit/dashboard-navigation.test.ts` both assert the designer is reachable
from Starter up.

---

## 8. AI strategy

AI is **on every tier**, differentiated by allowance: 25 / 300 / 1,500 generations
a month.

That is a deliberate reversal. Previously `ai` was Pro-only, which made AI the
single reason to upgrade from $19 to $49 — a bet that the core product was not
worth paying for. Putting a real allowance on Starter means a café can have the
AI write eight campaigns a month at $29, and the upgrade reason becomes volume and
scale rather than access.

**The AI is real.** `lib/ai/capabilities.ts` calls Anthropic with a genuine
business snapshot (metrics, segments, top rewards, recent campaign results, and
statistical anomalies from `passimo_detect_anomalies`) and returns structured,
validated output. There is no mocking anywhere, and no screen presents a canned
response as a generated one. Without `ANTHROPIC_API_KEY` every AI route answers
**503 `not_configured`** — which is the honest answer, and the order is verified:
anonymous gets 401, an over-quota merchant gets 402 naming the tier with more, and
only an entitled merchant on an unconfigured deployment sees 503.

The daily automatic insight feed is gated on `advanced_analytics` (Growth and
above) *and* metered. That is a cost fix, not a product one: the cron enqueued it
for every non-archived workspace with no entitlement check and no metering, so a
thousand tenants was a thousand model calls a day billed to us whether or not
anyone was paying for AI — and a workspace that cancelled six months ago kept
generating insights nobody could read. Starter's 25 generations belong to the
merchant's own campaign copy rather than to a background job that would consume
them all by the 25th.

---

## 9. Marketing strategy

Campaigns, automations and segments are on **Starter**. That is the single biggest
change in this pass and the one the entry price rests on.

Cost is controlled by the *send* allowance rather than by locking the screen:
10 / 50 / unlimited campaign sends a month, and 2,000 / 15,000 / 50,000 messages.
Starter's 2,000 covers a 500-customer list emailed four times a month with room to
spare, which is more than any café sends — it exists to stop a runaway automation
loop, not to ration marketing.

Growth adds what a bigger list actually needs: gift cards to sell, geofenced
notifications, the rule builder, and campaign-attributed revenue. Pro adds
memberships and the partner network.

---

## 10. Unit economics

Per-merchant monthly cost **at the caps** — the pessimistic figure, which is the
only one worth planning with.

| Cost line | Starter | Growth | Pro |
| --- | --: | --: | --: |
| Postgres (Railway, shared) | $0.40 | $1.20 | $3.50 |
| App hosting (shared) | $0.60 | $1.20 | $2.40 |
| Object storage | $0.05 | $0.15 | $0.40 |
| Wallet pass push | $0.05 | $0.25 | $0.80 |
| Email at the cap (~$0.60/1k) | $1.20 | $9.00 | $30.00 |
| AI at the cap (~$0.024/gen) | $0.60 | $7.20 | $36.00 |
| **Total at the cap** | **~$2.90** | **~$19.00** | **~$73.10** |
| **Margin at the cap** | **90%** | **68%** | **26%** |
| **Margin at realistic use** | **~95%** | **~88%** | **~85%** |

Realistic use is 10–20% of the metered allowances, which is what actually happens:
a café does not email its list every week, and nobody generates 1,500 campaigns a
month.

Three conclusions, each already a decision in the catalogue:

**The metered resources are the entire risk.** Postgres, hosting and storage are
rounding errors. Email, SMS, WhatsApp and AI are the only lines that can move —
which is exactly why those four have hard monthly caps and every one is enforced
server-side.

**Pro at the cap is a 26%-margin customer.** Acceptable, because reaching it
requires 50,000 emails *and* 1,500 AI generations in one month, and a business
doing that across ten locations is one we want. It is not acceptable as a
permanent state, which is why the allowance is a number rather than a promise.

**Blended margin at plausible mix.** Assuming 50/35/15 across Starter/Growth/Pro,
ARPU is ~$50 and blended gross margin is ~90%. That leaves room for the CAC a
local-business SaaS actually carries. Break-even on infrastructure alone arrives
in the low tens of merchants; the real question is acquisition cost, which is not
a pricing problem.

---

## 11. Billing status

| Area | State |
| --- | --- |
| Stripe client | Custom `fetch` client over six endpoints. Deliberate — the SDK is 3 MB for form-encoded POSTs. |
| Products / prices | Six prices via `STRIPE_PRICE_<PLAN>_<MONTHLY\|YEARLY>`. **Nothing hardcodes a price id.** |
| Customer creation | Lazy, on first checkout; id written back before the session; idempotency key `customer:<businessId>`. |
| Checkout | `mode: subscription`, automatic tax, promotion codes, address collection. |
| Plan change while subscribed | Routed to the **portal**, so Stripe owns proration and tax. |
| Portal | Invoices, cards, VAT, cancellation. |
| Webhook | `subscription.created/updated/resumed/deleted`, `invoice.paid`, `invoice.payment_failed`, gift-card checkout. |
| Signature verification | HMAC with `timingSafeEqual` **and** a 300-second timestamp tolerance, over the raw body. |
| Idempotency | Event id claimed in `subscription_events` with a unique index; `interpretClaim()` is a named, tested pure function over the Postgres error code. |
| Retries | `duplicate` → 200 (stop), `unavailable` → 500 (retry). Handler failures record the error and answer 500. |
| Failed payment | Four-stage dunning driven by Stripe's `attempt_count`, not by our own clock. |
| Delinquency | Plan **kept** through the grace period. |
| Unconfigured | Billing screen reports "not configured"; the loyalty product works unchanged. |

**The checkout route never sets a plan.** Stripe decides when money moved, and
believing anything else means a merchant who abandons the payment sheet after the
redirect gets a free Pro account. The success page says the plan can take a few
seconds to appear rather than pretending it has already applied.

**Not verified against live Stripe.** No `STRIPE_SECRET_KEY` is configured in this
environment, so the webhook, checkout and portal paths are covered by unit tests
and code review rather than by a real transaction. §17 records this as the largest
untested surface.

---

## 12. Feature gating status

One gate, three call sites, and the client one is a courtesy rather than a control.

- **Server:** `requireFeature`, `requireWithinLimit`, `meterAction`, or
  declaratively as `feature: 'x'` on `defineRoute`. The plan check runs *after*
  the permission check, so a viewer on Pro is told about their role and an owner
  on Starter is told about their plan — never the wrong one.
- **Client:** `can()` for role, `has()` for plan. Two functions on purpose: they
  fail for different reasons and deserve different UI. `has()` is optimistic while
  `/me` is in flight, because a locked screen flashed at a paying customer is the
  worse failure.
- **UI:** one `<UpgradePrompt>` everywhere, so the upgrade experience is identical
  and a merchant learns it once. A cap and a missing feature render differently:
  "You have 1 of 1 locations" is a different sentence from "Geofencing is on
  Growth".

**Every refusal names its remedy** — the cheapest plan that would have allowed the
call — or `null` when nothing in the catalogue would, which the paywall renders as
"get in touch" instead of a button leading to the same 402. Verified: a Starter
merchant blocked on gift cards is told *"Available from Growth"*; on memberships,
*"Available from Pro"*; a lapsed merchant is told *"Reactivate from Starter — nothing
has been deleted."*

### Adversarial verification

A 19-case probe over HTTP against the running build, as four demo merchants:

| Attempt | Result |
| --- | --- |
| Starter creates a second location | 402 → growth |
| Starter issues a gift card | 402 → growth |
| Starter creates a proximity campaign | 402 → growth |
| Starter creates a membership | 402 → pro |
| Starter imports 900 rows on a 500 cap | 402 → growth |
| Growth creates a membership | 402 → pro |
| Lapsed adds a customer / creates a campaign | 402 → starter |
| Lapsed **reads** its customers | 200 |
| Starter creates a campaign / a segment | 200 (correctly allowed) |
| Growth creates a proximity campaign | 200 |
| Pro creates a membership | 200 |
| **Forged `plan: "pro"` in the request body** | 402 → growth |
| **Forged `?plan=pro&effective_plan=pro`** | 402 → growth |
| **Forged `x-plan` / `x-passimo-plan` headers** | 402 → growth |
| **Extra `plan=pro` cookie alongside the session** | 402 → growth |
| **Starter session pointing at the Pro workspace** | 403 forbidden |
| **Starter session reading Pro's customers** | 403 forbidden |

19/19. Nothing the client can send changes the answer: the resolver reads
`businesses.plan` for the session's own workspace and nothing else.

---

## 13. Upgrade, downgrade, cancellation and trial

**Upgrade.** Immediate, prorated by Stripe, applied by the webhook. Every paywall
carries the price and one button. When a merchant approaches a cap, the billing
screen shows current usage, the plan limit, the next plan's allowance and its
price — inline on the meter, before the refusal rather than after it. No countdown
timers, no fake scarcity, no "only today" copy.

**Downgrade.** Safe, and said out loud before the click. Nothing is deleted, ever.
A merchant moving from Growth to Starter with three shops keeps all three: they
stay in the table, they stay visible, they keep working, and only *adding* a
fourth is refused. Archiving frees a slot, so the way back under a cap is to
archive rather than to delete — and the integration suite asserts both halves.

The billing screen reads live usage against the next plan down and lists exactly
which resources would go over, alongside the reassurance that over-cap means
read-only rather than gone. It renders only for a workspace that has something to
lose, so a café with one location never reads a paragraph about a conflict that
cannot happen to it.

**Cancellation.** Runs to the end of the paid period, then lapses. The billing
screen states, in the order people ask: when access ends, that customers and
history are kept, that wallet passes stay on phones but stop updating, that the
dashboard stays readable, and that reactivating is one click. The action itself is
Stripe's portal, which owns the confirmation and the receipt.

**Failed payment.** A declined card keeps the plan through Stripe's dunning window
and produces four warnings, including one that says "this is the last attempt".
Each states plainly that nothing has been deleted. Recovery gets a message too —
silence after three warnings reads as "still broken". Dropping someone to `lapsed`
the hour a bank declines a card is how a customer is lost over a fraud check.

**Trial.** Fourteen days on **Growth**, no card. Changed from Pro, for two reasons
that point the same way. Commercially, Growth is the plan we most want merchants
to buy, so the fortnight is spent inside the product actually being sold and the
day-15 question is "keep this?" rather than "which of three things was I using?" —
a merchant who trials Pro learns to depend on memberships, then meets a $99 invoice
for a café that needed $29 of software. Financially, a trial has no card on file,
and Growth's 300 generations and 15,000 messages cannot be scripted into a bill.

Every screen that mentions the trial now names the tier. The banner used to say
"everything unlocked", which stopped being true the moment trials moved off the
top tier — and it also told merchants they would "move to Free", a plan that had
not existed for two catalogues. Both are fixed, and the banner is localised now;
it was hard-coded English, which meant a Spanish merchant met the one message that
costs them money in a language they had not chosen.

**Trial ≠ free plan.** `subscription.status = 'trialing'` never means
`plan = 'free'`. `verify:functional` asserts that a brand-new workspace resolves
to a *purchasable tier priced above zero*, and that it has Growth's features and
not Pro's.

---

## 14. Demo accounts

Five workspaces plus a platform admin. One per purchasable plan, plus the two
lifecycle states no paid plan can reach. All in `DEMO_CREDENTIALS.md`, all
password-driven from `DEMO_PASSWORD`, all seeded deterministically and safe to
reset.

| Plan | Business | Email | Customers | Locations | Seats | Memberships |
| --- | --- | --- | --: | --: | --: | --: |
| Starter $29 | Madrid Coffee (café) | `starter@demo.com` | 140 / 500 | 1 / 1 | 3 / 3 | — |
| Growth $59 | Barcelona Barber | `growth@demo.com` | 420 / 5,000 | 3 / 3 | 4 / 10 | — |
| Pro $99 | Sevilla Bakery | `pro@demo.com` | 1,240 / 20,000 | 4 / 10 | 6 / 25 | 2 plans, 74 members |
| Trial → Growth | Bilbao Pizzeria | `trial@demo.com` | 45 | 1 | 2 | — |
| Lapsed | Zaragoza Florist | `lapsed@demo.com` | 60 | 1 | 1 | — |

Every workspace sits inside its own caps. That is deliberate: a demo account
already over its limit teaches a reviewer that the limits do not hold. `lapsed` is
the exception, and there the "60 / 0" reading is the state working correctly — zero
is what refuses a *write*.

Confirmed against the seeded database: `passimo_platform_overview()` reports
**$187/month MRR** — exactly $29 + $59 + $99, with the trial excluded because it
has no invoice behind it.

Three demo problems were found and fixed while doing this:

- **`business@demo.com` / Valencia Fitness survived a re-seed.** The seed only
  ever upserted what it knew about, so removing a merchant from the definitions
  left the workspace in the database forever — remapped by the migration to the
  same `pro` the new one was on, so the admin console showed two Pro accounts and
  $198 of MRR from three subscriptions. The seed now retires demo workspaces it no
  longer defines, and the accounts that owned them (releasing
  `reward_redemptions.redeemed_by` first, which has no delete rule).
- **Eight `MAT gate …` membership plans had accumulated** on three demo
  workspaces across eight acceptance runs. Nothing swept them, and they were
  actively harmful rather than merely untidy: they were suppressing the real
  membership seeding through a broad "does this business have any plan?" guard.
  The residue sweep now covers `MAT %` as well as `zz-verify%`, and
  `membership_plans` as well as the other five tables.
- **Stale staff invites.** The invite address encodes the member's *position* in
  the roster, so raising Starter's cap from two seats to three moved the counter
  staff from slot 1 to slot 2 and a re-seed left the old row beside the new one.
  The seed now deletes `@demo.invalid` invites the roster no longer defines.

### Demo credential security

Development and staging only. The seed refuses to run unless
`NEXT_PUBLIC_APP_URL` looks like a development host. No production secret, key or
certificate appears in `DEMO_CREDENTIALS.md` or is needed to use any of it.
Customer addresses are `@example.com`; test-written addresses use `.invalid`, an
RFC 2606 reserved TLD that can never be registered — nothing in the demo can send
mail to a real person. Membership rows carry `stripe_price_id = null`, which is
the honest state of a deployment with no Stripe rather than a fabricated
subscription.

---

## 15. Testing

| Suite | Count | Covers |
| --- | --: | --- |
| `pnpm test` (unit) | 694 | Catalogue invariants, prices, annual ratio, legacy remapping, `resolveEntitlements`, dunning, webhook idempotency, i18n, nav gating, checklist gating |
| `pnpm test:integration` | 116 (7 files) | **Real Postgres.** Entitlements per tier, caps counted against live rows, metering, trial lifecycle, downgrade safety, tenant isolation |
| `pnpm test:e2e` | 214 | Demo plans per tier at desktop **and mobile**; pricing prices, no free tier, shared-floor strip, ROI framing, no horizontal scroll; onboarding plan step; card designer |
| `pnpm verify:functional` | **821 pass, 0 warn, 0 fail** | Every plan over HTTP against a production build: catalogue, prices, both locales, structured data, feature gates, limits, tenant isolation, admin, new-merchant journey |
| `pnpm db:verify` | 239 pass, 0 fail | Schema, functions, indexes, RLS, and the twelve `scripts/db/*.sql` reports |
| `scripts/db/004_subscriptions.sql` | all PASS | The database's own view: catalogue vs column, no legacy plan ids, live usage vs caps, self-contradictory billing states |
| Adversarial HTTP probe | 19/19 | Forged plan in body/query/header/cookie, cross-tenant writes and reads |

New this pass:

- `tests/integration/entitlements.test.ts` — 24 tests. The gap it closes: unit
  tests prove the catalogue is consistent, but they have no `customers` table to
  count, so nothing tested whether a *count against live rows* refuses the write.
  All three of the enforcement bugs in §6 were invisible to the existing suite.
- The **cap-zero ⇔ feature-absent** invariant, in both directions.
- **No-phantom-feature** assertions for the four removed names.
- **Exactly $29/$59/$99** and **annual is ten months on every tier**.
- Trial assertions that pin it to Growth and to a *purchasable, non-zero* tier.
- `createTenant(label, { plan, subscriptionStatus, trialEndsAt })`, so a test can
  pin a fixture to a tier.

Four tests were found to be passing, or failing, for the wrong reason:

- A location insert used a column that does not exist (`is_primary` rather than
  `is_default`), so the cap was never approached and the refusal never fired. The
  insert error is now asserted, because a fixture that silently does nothing makes
  a limit test pass by never reaching the limit.
- The free-plan sweep was **lexical** in three places, so it flagged the pricing
  FAQ's own question *"Is there a free plan?"* — the copy written to deny the
  thing. All three are structural now (no `$0`, no tier named Free) plus a
  positive assertion that the FAQ answers "No."
- The card-designer checklist test asserted `"0 of 6 done"`, a hidden dependency
  on the plan catalogue: the visible item count is whatever the merchant's tier
  can reach, so it moved when the trial changed tier. It now asserts
  `/^0 of \d+ done$/` and a nonzero total, which is what the test is actually
  about.
- The onboarding walkthrough clicked a button by its old label. Fixed, and
  strengthened while there: the plan step now also asserts all three prices, the
  trade-based recommendation badge, and the "change or cancel at any time" line.

---

## 16. Risks

**1. SMS and WhatsApp are mispriced, and it is the one risk large enough to
change a plan over.** All channels share a single `messages_per_month` meter,
which is honest about volume and wrong about cost. At ~$0.04 per SMS, Pro's
50,000-message allowance spent entirely on SMS is **~$2,000 against a $99
subscription**. It holds today only because no SMS provider is configured and
email dominates.

> **Recommendation: do not enable SMS or WhatsApp until the meter is split by
> channel.** Either separate `sms_per_month` / `whatsapp_per_month` limits, or a
> weighted meter where an SMS costs ~60 message units. This is a half-day of work
> and it is not optional before the first SMS send.

**2. Pro at the cap is a 26%-margin customer.** Tolerable, and bounded by the fact
that reaching it needs 50,000 emails *and* 1,500 generations in one month. Worth
monitoring rather than acting on.

**3. Price increase for hypothetical existing subscribers.** Old `pro` was $49 and
new `pro` is $99. There are no live subscribers (no Stripe key is configured
anywhere), so this is theoretical — but if any existed, Stripe is authoritative on
what they are charged and they would keep their $49 price until they changed plan.
The `business` → `pro` remap is at the same $99, so no invoice moves.

**4. `business` was unlimited; Pro is not.** A workspace remapped from `business`
and already holding more than 20,000 customers, 10 locations or 25 seats keeps all
of it — reads are ungated and nothing is deleted — but cannot add more. Migration
`000024` *reports* any row in that position as a warning rather than acting on it,
so it is a support conversation rather than a surprise. On the demo seed: no rows.

**5. No live Stripe verification.** The webhook, checkout and portal are covered
by unit tests and review, not by a real transaction. This is the largest untested
surface in the system.

**6. $29 is untested against the market.** It is defensible on cost, on
positioning and on the value of what Starter now includes. It is not validated by
a single paying merchant, because there are none yet. The 14-day trial is the
instrument for finding out.

---

## 17. Remaining issues

Honest list. None blocks charging money; all are recorded rather than hidden.

| # | Issue | Severity | Note |
| --- | --- | --- | --- |
| 1 | Channel-blind message meter | **High** | §16.1. Blocks enabling SMS/WhatsApp, nothing else. |
| 2 | `team_members` has no write path | Medium | Seats are counted, displayed and capped, but there is no invite endpoint and no team screen, so the only member a workspace can create is the owner at signup. The cap is correct and unreachable. Not presented as enforcement anywhere. |
| 3 | Live Stripe unverified | Medium | §16.5. |
| 4 | Pro's AI story is thinner than the card implies | Low | Growth and Pro differ in AI by *volume*, not capability. Pro's honest differentiators are memberships, the partner network and scale — which is what the card leads with, but "Daily AI insights, churn prediction" reads as a capability difference and is really an allowance one. |
| 5 | Partner network has no demo data | Low | A coalition needs two entitled businesses and Pro is the only tier with the feature, so there is nobody for the Pro demo to partner with. The screen renders and the API accepts an offer. Documented in `DEMO_CREDENTIALS.md` rather than fabricated. |
| 6 | `DEMO_CREDENTIALS.md` feature matrix not re-probed | Low | Derived from the catalogue and consistent with it; the last end-to-end sign-in sweep predates pricing v2. The file says so. `pnpm verify:functional` re-confirms it, and did: 821/0/0. |
| 7 | `sales_email` field is now vestigial | Cosmetic | No tier has a `null` price, so the "talk to us" branch is unreachable. The API still returns the field; the dead UI branch was removed. |
| 8 | 2,193 stale queue rows in the dev database | Cosmetic | Pre-existing, from seeding without a worker running. Not a pricing issue. |

---

## 18. Final recommendation

**Ship at $29 / $59 / $99.**

The pricing is defensible on unit economics, coherent across every surface, and
enforced where it has to be — with the enforcement proven against a real database
and a running API rather than asserted. Starter is now a product a café can run a
business on, which is what makes $29 a reasonable number rather than a cheap one,
and the upgrade path is driven by scale and genuine capability rather than by
artificial crippling.

The three things to do next, in order:

1. **Split the message meter by channel** before enabling SMS or WhatsApp. Half a
   day. Non-negotiable — §16.1.
2. **Configure Stripe in test mode and run one real subscription end to end** —
   checkout, webhook, upgrade through the portal, a declined card via a test card,
   and a cancellation. Everything else about this system has been verified against
   something real; this has not.
3. **Onboard ten merchants at these prices and watch what they actually hit.**
   Which cap they reach first is the only real evidence about whether the limits
   are set correctly, and it is the only thing on this list that cannot be
   engineered.

The thing not to do is discount. The trial is the instrument for reducing risk on
the merchant's side; a lower price would only reintroduce the problem this pass
existed to fix.
