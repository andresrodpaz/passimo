# Pricing

Three plans. **$29 / $59 / $99** a month, or ten months' price for a year. No free
plan, and no permanent $0 tier.

The catalogue lives in exactly one file — [`lib/billing/plans.ts`](../lib/billing/plans.ts)
— and every surface that mentions a price, a cap or a feature reads it from
there: the pricing page, the landing hero, the structured data, the onboarding
plan step, the billing screen, the paywalls, the API refusals and the admin MRR
report. Changing a number is a one-line edit and a deploy.

This document is the *why*. [`SUBSCRIPTIONS.md`](SUBSCRIPTIONS.md) is the how it
is enforced, and [`BILLING.md`](BILLING.md) is the money.

---

## 1. The catalogue

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
| Proximity campaigns (active) | — | 15 | 50 |
| Automation rules (active) | — | 20 | 100 |

Yearly is ten months' price on every tier, so the annual discount is a flat 17%.
`annualSavingPercent()` derives it, and a unit test asserts it is the same on all
three — a per-plan ratio would turn the "two months free" badge into a promotion
nobody can reason about.

### Features by tier

| Feature | Starter | Growth | Pro |
| --- | :--: | :--: | :--: |
| `custom_branding` — brand kit and the wallet card designer | ● | ● | ● |
| `wallet_proximity` — pass surfaces on the lock screen nearby | ● | ● | ● |
| `campaigns` — email, SMS, WhatsApp, push | ● | ● | ● |
| `automations` — welcome, birthday, win-back, reward-ready | ● | ● | ● |
| `segments` — saved segments and the condition builder | ● | ● | ● |
| `ai` — campaign copy, insights, segment building | ● | ● | ● |
| `multi_location` | | ● | ● |
| `geofencing` — merchant-defined, entry / exit / dwell | | ● | ● |
| `proximity_campaigns` | | ● | ● |
| `automation_rules` — the no-code IF/THEN builder | | ● | ● |
| `gift_cards` | | ● | ● |
| `advanced_analytics` — cohorts, churn, CLV, attribution | | ● | ● |
| `memberships` — paid recurring memberships | | | ● |
| `coalition` — the partner network | | | ● |
| `priority_support` | | | ● |

Two invariants, asserted by `tests/unit/billing.test.ts`:

- **No feature is ever removed as the plan gets more expensive**, and no limit is
  ever lowered. A merchant who upgrades must never lose something they had.
- **A cap is zero if and only if the plan lacks the feature.** Both halves matter.
  A plan that grants a feature and caps it at zero shows the merchant a working
  screen and refuses the click with a quota error; a plan that caps a feature it
  does not grant is the mirror image, and it shipped — Starter once carried
  `proximity_campaigns: 2` without the feature, so the billing meter read
  "0 / 2" beside a screen answering "available from Growth".

---

## 2. Why $29 and not $5

The previous catalogue started at $5, with the argument written into the code:
*less than two coffees, which is the comparison a café owner actually makes.*

The comparison was right and the conclusion was wrong, for three reasons.

**$5 does not pay for the product.** A merchant on the entry tier costs real
money to serve: Postgres rows and connections, wallet pass storage and push
registrations, a share of the app host, and — the moment they touch marketing or
AI — per-message and per-token charges billed to us. Section 6 works the numbers.
At $5 the entry tier is subsidised by the tiers above it, which is a fine strategy
for a company with those tiers already full and a bad one for a company acquiring
its first paying merchant.

**A $5 price sets a $5 expectation.** Software priced at two coffees is
*evaluated* like two coffees: nobody schedules training for it, nobody assigns
anyone to it, and nobody misses it when it stops. The merchants who churn fastest
are not the ones who found it expensive.

**The gap between $5 and $19 made the ladder unreadable.** Four tiers at $5 / $19
/ $49 / $99 asked a café owner to place themselves on a 20× spread while reading
a forty-row matrix. Three tiers on a roughly 1 : 2 : 3.4 ladder is a decision
someone can make between customers.

What survives from the old argument is the *audience*. $29 is still a small
number for a business that is actively trying to bring customers back — it is
one or two covers, a couple of haircuts, a fraction of a day's takings. The
positioning is "affordable enough for a small business, powerful enough to be
taken seriously", and the way to hold both is to make the cheap plan genuinely
good rather than to make the price genuinely small.

---

## 3. What Starter has to be

The entry tier survives exactly one question: *can I actually run my shop on
this?* So it is the complete loyalty product rather than a demonstration of one.

A café on Starter can design their wallet card, put their logo and colours on it,
choose a template and pick what the card shows, print a QR code, scan customers
at the counter on any phone or laptop, run ten campaign sends a month, leave the
welcome / birthday / win-back automations running, segment their list, and ask the
AI to write copy twenty-five times a month.

What Starter does not include is the second location, the geofence the merchant
configures themselves, gift cards, memberships, cohort analytics and the partner
network. Every one of those is something a one-site café with 200 customers does
not need this month. **That is the difference between a limit and a mutilation**,
and it is the line the whole pricing model rests on: nobody upgrades because we
broke something on purpose.

Three things in particular are deliberately *not* gated, and each was considered:

- **The wallet card designer.** The card is the product. "Change my logo" and
  "change my brand colours" behind a paywall would make Starter a trial with a
  price on it.
- **Campaigns and automations.** A merchant who can collect customers but not
  contact them is running a mailing list they cannot mail. The cost is controlled
  by the *send* allowance, not by locking the screen.
- **AI.** It is on every tier, differentiated by allowance — 25 / 300 / 1,500
  generations a month. Making AI the only reason to upgrade would be a bet that
  the core product is not worth $29, and it is.

---

## 4. Why somebody upgrades

The upgrade sentence has to be something the merchant says, not something we say.

**Starter → Growth ($29 → $59).** *"I opened a second shop"*, or *"my list got
past five hundred people"*, or *"I want the card to come back to customers when
they walk past the door and I want to set the radius myself."* Growth is ten times
the customers, three sites with per-site reporting, geofences the merchant
defines, gift cards to sell, cohort and churn analytics, and twelve times the AI
allowance. It is marked "Most popular" because it is the plan we recommend, not
because we have counted anything — and the copy says "Most popular" rather than
quoting a percentage, because we have no honest percentage to quote.

**Growth → Pro ($59 → $99).** *"I run four shops"*, or *"I want to sell
memberships"*, or *"I want the daily insight feed and the churn predictions."* Pro
adds paid memberships as the merchant's own recurring revenue, the partner
network, ten locations, twenty thousand customers, unlimited campaign sends, five
times the AI allowance, and priority support.

Pro is deliberately **not unlimited**. The tier it replaced advertised `∞` on
every cap; unlimited inference and unlimited SMS on a $99 subscription is how a
SaaS acquires a customer it loses money on every month. A large number is the
honest version of a top tier — and a merchant who genuinely needs more than
20,000 customers is a conversation, not a checkbox.

---

## 5. What the trial is, and is not

Fourteen days, no card, running on **Growth**.

A trial is not a plan. It is temporary access to one, and the workspace still
belongs to a real paid tier for the duration — `subscription.status = 'trialing'`
never means `plan = 'free'`, because there is no `free`.

**Why Growth rather than Pro.** Commercially, Growth is the plan we most want
merchants to buy, so the fortnight is spent inside the product actually being sold
and the day-15 question is "keep this?" rather than "which of three things was I
using?". A merchant who trials Pro learns to depend on memberships and the partner
network, then meets a $99 invoice for a café that needed $29 of software — and the
most likely outcome of that mismatch is no sale at all. Financially, a trial has
no card on file: Growth's 300 AI generations and 15,000 messages are generous
enough that nobody reaches them in two weeks and small enough that a scripted
signup cannot run up a bill.

**Where it goes.** Successful billing → `active` on whichever tier was bought. No
billing → `lapsed`, which is not a working tier and not a deletion. Reads keep
working, every write answers 402 with one remedy, and nothing is ever removed. The
reactivation wall says *nothing has been lost* before it asks for money, because
that is the only order in which the sentence is true.

---

## 6. Unit economics

Per-merchant monthly cost, at the caps rather than at typical usage — the
pessimistic number, which is the only one worth planning with.

| Cost | Starter | Growth | Pro | Notes |
| --- | --: | --: | --: | --- |
| Postgres (Railway, shared) | $0.40 | $1.20 | $3.50 | Rows, connections and backup volume scale with customers and events. |
| App hosting (shared) | $0.60 | $1.20 | $2.40 | Requests scale with scans and dashboard use, not linearly with plan. |
| Object storage (logos, exports) | $0.05 | $0.15 | $0.40 | Small: a logo and a card design per workspace. |
| Wallet pass push (APNs / Google) | $0.05 | $0.25 | $0.80 | Registration rows and push volume. Both providers are free per message; the cost is our own compute. |
| Email at the cap | $1.20 | $9.00 | $30.00 | ~$0.60 per 1,000 (Resend-class). |
| AI at the cap | $0.60 | $7.20 | $36.00 | ~$0.024 per generation, mixed Sonnet/Haiku, 4–10k tokens. |
| **Total at the cap** | **~$2.90** | **~$19.00** | **~$73.10** | |
| **Gross margin at the cap** | **90%** | **68%** | **26%** | |
| **Gross margin at realistic use** | **~95%** | **~88%** | **~85%** | 10–20% of the metered allowances, which is what actually happens. |

Three conclusions, and each one is a decision already made in the catalogue:

**The metered resources are the whole risk.** Postgres, hosting and storage are
rounding errors; email, SMS, WhatsApp and AI are the only lines that can move.
That is why those four are the ones with hard monthly caps and why every one of
them is enforced server-side — see §7.

**SMS and WhatsApp are the unpriced hazard.** At roughly $0.04 per SMS, Pro's
50,000-message allowance spent entirely on SMS is ~$2,000 against a $99
subscription. The current model treats all channels as one `messages_per_month`
meter, which is honest about volume and wrong about cost. It holds today because
no SMS provider is configured and email dominates; it is the first thing to
revisit before SMS ships. **This is the largest open risk in the pricing model**
and it is recorded as such in `PRICING_AUDIT.md`.

**Pro at the cap is a 26%-margin customer.** Acceptable, because reaching the cap
requires 50,000 emails *and* 1,500 AI generations in one month, and a business
doing that at ten locations is one we want. It is not acceptable as a permanent
state, which is why the allowance is a number rather than a promise.

---

## 7. Where the model is enforced

Prices and caps that live only on a marketing page are decoration. Every one of
these is checked server-side, in the same functions the routes call, and none of
them trusts anything the client sends.

| Cap | Enforced by | Where |
| --- | --- | --- |
| `customers` (single add) | `requireWithinLimit` | `POST /api/v1/customers` |
| `customers` (bulk import) | `requireWithinLimit` + per-chunk headroom | `POST /api/v1/customers/import`, `lib/customers/import.ts` |
| `customers` (public sign-up) | **soft** — `reportSoftLimit` | `POST /api/v1/public/join` |
| `locations` | `requireWithinLimit` | `POST /api/v1/locations` |
| `messages_per_month` | `measureLimit` on marketing sends; reserved up front on campaign send | `lib/messaging/dispatch.ts`, `POST /api/v1/campaigns/[id]/send` |
| `ai_actions_per_month` | `meterAction` | `POST /api/v1/ai`, `ai.generate_insights` job |
| `campaigns_per_month` | `requireWithinLimit` + `trackUsage` | `POST /api/v1/campaigns/[id]/send` |
| `proximity_campaigns` | `requireWithinLimit` (active rows only) | `POST/PATCH /api/v1/wallet/campaigns` |
| `automation_rules` | `requireWithinLimit` (active rows only) | `POST/PATCH /api/v1/wallet/rules` |
| `team_members` | measured and displayed; **no write path exists** | see the note below |
| every `Feature` | `requireFeature`, or `feature:` on `defineRoute` | `lib/api/handler.ts` |

Two of those rows deserve their reasoning stated rather than implied.

**The public sign-up is a soft limit, deliberately.** A merchant over their
customer cap keeps enrolling people at the counter, and we tell the owner once a
day instead. Refusing a customer standing in front of a till in order to sell an
upgrade costs the merchant a real sale to make us a hypothetical one; that trade
never favours us, and a merchant who watched us embarrass them in front of a
customer churns. The bulk importer is the opposite case — the merchant is acting
deliberately, on a file — so it is hard.

**`team_members` has no write path to enforce.** Seats are counted, displayed and
capped in the catalogue, but there is no invite endpoint and no team screen, so
the only team member a workspace can create is the owner at signup. The cap is
therefore correct and currently unreachable. This is recorded honestly in
`PRICING_AUDIT.md` rather than presented as enforcement.

---

## 8. What was removed, and why

**The fourth tier.** `business` sat at $99 with unlimited everything. Pro now sits
at that same $99, so no invoice moves; migration `000024_pricing_v2.sql` rewrites
the stored plan ids and `normalizePlanId()` maps the old value in code so a deploy
cannot gate a paying customer before the migration runs. Pro is not unlimited, so
the migration *reports* — as a warning, not an action — any workspace that lands
above a Pro cap. Nothing is deleted and nothing is blocked retroactively.

**Four features that did not exist.** `sso`, `api_access`, `webhooks` and
`team_management` were advertised on the old top tier and implemented nowhere: no
route checked them, no screen unlocked behind them. A merchant could have paid $99
for four things that were never going to arrive. They are gone from the catalogue
rather than renamed.

**"Founder pricing for life."** The landing page promised a price lock we had not
designed, which also made the three published prices look negotiable. Early access
is a real thing we are doing — direct access to the team, hands-on setup — and it
says that now instead.

**A competitor's price.** The comparison table quoted "generic loyalty apps: $29
and up", which was an unsourced claim about somebody else's price list and, now
that Starter is $29, a line that made our own entry tier look like the expensive
option. It describes the shape of the deal instead.

---

## 9. Changing a price or a cap

1. Edit `lib/billing/plans.ts`. That is the only place a number lives.
2. `pnpm test` — the invariant tests will tell you if the catalogue became
   inconsistent (a feature removed on upgrade, a lowered cap, a cap that
   contradicts a feature gate, an annual price that is not ten months).
3. Add or update the Stripe price ids in the environment
   (`STRIPE_PRICE_<PLAN>_<MONTHLY|YEARLY>`). Existing subscriptions keep the price
   they were sold; Stripe is authoritative on what anyone is charged.
4. If a plan id changed, write a migration: the `businesses_plan_check` constraint
   and `passimo_platform_overview`'s MRR arithmetic both name tiers, and
   `normalizePlanId()` needs the old value mapped for the deploy window.
5. `pnpm test:integration` for the enforcement, and `pnpm seed:demo` so the demo
   accounts still sit inside their own caps.

Nothing else needs touching. Every user-facing surface is generated.
