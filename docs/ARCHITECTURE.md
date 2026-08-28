# Architecture

How Passimo is put together, and the reasoning behind the decisions that would
otherwise look arbitrary.

---

## 1. The request pipeline

Every API route is declared with `defineRoute`, which applies the cross-cutting
concerns in a fixed order:

```
request id + logger      every later failure is traceable
     ↓
rate limit               cheapest rejection first
     ↓
authentication           before any DB work
     ↓
schema validation        body / query / params via zod
     ↓
business + permission    needs parsed input to know the target tenant
     ↓
handler
```

A route therefore contains only business logic. There is no route where a
developer can forget to check a permission, because the permission is declared
alongside the schema and enforced by the wrapper.

**Errors** are thrown as typed `AppError`s and rendered into one envelope:

```json
{ "error": { "code": "unprocessable", "message": "…", "details": [], "request_id": "…" } }
```

`expose: false` errors (anything 5xx) return a generic message to the client and
log the full detail server-side. Clients branch on `code`, never on prose.

---

## 2. Authentication and authorisation

Three entry points collapse into one `Actor`:

| Kind | Credential | Used by |
| --- | --- | --- |
| `user` | `passimo_session` cookie, or the same token as a bearer | Dashboard, POS, mobile |
| `api_key` | `Authorization: Bearer psm_…` | Integrations, Zapier, partners |
| `system` | Cron shared secret | Scheduled jobs, worker |

Downstream code asks the actor for a *permission*, never for a role or a token
type. Roles (`owner`, `admin`, `manager`, `staff`, `viewer`) are just bundles of
permissions defined in one file, so adding a capability is one line, not a hunt
for `role === 'owner'` checks.

`requireBusinessAccess(actor, businessId)` resolves the actor's role on a
specific business and throws `forbidden` when there is none. It memoises for 15
seconds — every authorised request needs it, role changes are rare, and 15s
bounds the staleness of a revoked grant.

**RLS is the second layer.** Every tenant table has a policy calling
`passimo_has_business_access(business_id)`. Secret-bearing tables (`api_keys`,
`integrations`, `rate_limits`) have RLS enabled with *no* permissive policy:
service role only. The ledger has an insert policy and no update/delete policy,
so corrections must be posted as reversals even by an owner.

---

## 3. Plans and entitlements

Authorisation answers "may *this person* do this?". Entitlement answers "does
*this workspace pay for* this?". They fail for different reasons and deserve
different responses, so they are separate gates and separate status codes:
`403` for a role, `402` for a plan. Collapsing them is how a product shows an
upgrade page to someone whose company already pays.

`lib/billing/plans.ts` is the single definition of every tier — features,
limits, prices, marketing copy. It is isomorphic and imported by the pricing
page, the billing screen, the paywall component and the API gate, so the site
can never advertise something the API refuses to deliver. A unit test asserts
the ladder is monotonic: no upgrade ever removes a feature or lowers a limit.

Routes declare their requirement:

```ts
defineRoute({ name: 'giftcards.issue', feature: 'gift_cards', ... })
```

Limits come in two kinds, and the distinction is a product decision, not a
technical one:

| Kind | Enforcement | Used when |
| --- | --- | --- |
| **Hard** — `requireWithinLimit` | Throws 402 before the write | The *merchant* is acting: importing a list, adding a location, inviting staff |
| **Soft** — `reportSoftLimit` | Allows it, notifies the owner once a day | *Their customer* is acting: enrolling at the counter, earning a stamp |

Refusing an enrolment while someone stands at the till costs the merchant a real
sale to sell them an upgrade. That trade never favours us. The overage happens;
the owner hears about it once, not once per scan.

Three further rules the implementation encodes:

- **Billing never breaks the product.** A failed usage lookup logs and allows.
- **Reads are never gated.** A downgrade hides no data the merchant already has.
- **Every refusal names its remedy** — the 402 body carries the cheapest plan
  that would have allowed the call, so the UI renders one button.

Stripe is the only writer of subscription state. The checkout route never sets a
plan; `customer.subscription.*` does. Believing the redirect instead would give
a free Pro account to anyone who abandons the payment sheet. The webhook claims
each event id in `subscription_events` before handling it, so Stripe's
at-least-once delivery becomes exactly-once processing.

---

## 4. Commerce

Three modules sit on the loyalty engine rather than beside it, so a gift card
purchase and a membership renewal land in the same ledger, activity feed and
reports as everything else.

| Module | Money moves in | Idempotency |
| --- | --- | --- |
| Gift cards | `passimo_issue_gift_card` / `_redeem_` / `_void_` | Key on `gift_card_transactions` |
| Memberships | `passimo_enroll_membership`, `passimo_renew_memberships` | `membership:<id>:<period>` on the ledger credit |
| Coalition offers | `passimo_redeem_coalition_offer` | Key on `coalition_redemptions` |

Each takes a row lock and appends an immutable transaction row. Nothing reads a
balance into JavaScript and writes it back — the same rule as
`passimo_credit_account`, for the same reason.

Fulfilment side effects (delivery email, merchant notification, webhook) happen
*after* the transaction commits, through the outbox. A mail provider outage can
never undo a sale.

---

## 5. Growth and the network

Referral attribution is already in SQL: `passimo_enroll_customer` records the
link and `passimo_qualify_referrals` pays out only once the referred friend
actually transacts, which is what stops self-referral farming. The referral
*rewards* are ordinary earning rules on the `referral` and `referred_signup`
triggers — so they inherit day/time windows, caps, cooldowns and tier targeting
for free, and there is one place where "how much do we award" is decided.

The coalition is the only feature here with a real network effect: a loyalty app
is worth the same to the tenth merchant as the first, but a network of local
businesses that swap customers is worth more with every one that joins. Three
rules make it something a merchant will actually switch on:

1. **Opt in, per business.** `network_opt_in` defaults to false.
2. **No customer list is ever shared.** A partnership grants the right to
   *honour* the other side's members and publish offers to them. Directory
   reach is bucketed ("500–2,000 members"), never exact, so the directory is not
   a reconnaissance tool.
3. **Both sides must agree**, and either can end it instantly — which also
   deactivates that partnership's offers.

Reputation runs the same loop in the other direction. Promoters (9–10) get the
public review link; detractors (0–6) reach the owner privately first. Nobody is
prevented from reviewing and nothing is filtered — we simply do not solicit a
five-star review from someone who has just said they were unhappy, and the
detractor path is a real apology with a recorded fix, not a dead end.

## 6. The loyalty engine

### Why a ledger

The original schema kept a balance in `customers.stamp_count` and mutated it
from application code. That has three fatal properties:

1. **Lost updates.** Two concurrent taps read the same value and write back the
   same increment. One customer's stamp vanishes.
2. **No audit.** When a balance is wrong there is no way to find out why.
3. **No expiry.** You cannot expire "the points earned in March" if you only
   store a single integer.

The engine now has three pieces:

- `loyalty_accounts` — one balance row per (customer, program)
- `loyalty_ledger` — immutable, append-only, signed amounts
- FIFO `remaining` on each credit — so redemption consumes the oldest /
  soonest-expiring balance first, and expiry is exact

Invariant: `sum(remaining over open credits) == accounts.balance`. Redemption
and the expiry sweep both depend on it, which is why the data migration writes
one opening-balance entry per account rather than replaying history as credits.

### Where the logic lives

Rule *matching* is a pure function in `lib/loyalty/rules.ts` — no database, no
clock of its own. That is what makes the money-affecting logic exhaustively
unit-testable.

Rule *application* is `passimo_record_earn` in Postgres: the activity event and
every resulting balance change either all commit or none do.

```
POST /loyalty/earn
  → load program config (30s cache)
  → evaluateProgram()          pure: which rules match, how much
  → passimo_record_earn()      atomic: event + N credits + rollups
  → enqueue wallet push, automation enrolment, webhook
```

### Idempotency

Three independent layers, because each covers a different failure:

| Key | Covers |
| --- | --- |
| `loyalty_ledger.idempotency_key` | A retried POS tap |
| `activity_events (business, source, external_id)` | A replayed provider webhook |
| `jobs.idempotency_key` | An at-least-once trigger enqueuing twice |

---

## 7. Segments

A saved segment stores a filter *definition*, not a frozen customer list, so an
audience stays correct as people move in and out of it. The same definition
powers campaign targeting, automation eligibility and the customers table
filter — one language, three surfaces.

Compilation to SQL is safe by construction:

1. Column names come from the `SEGMENT_FIELDS` allow-list, never from input.
2. Operators are matched against a closed set.
3. Every value is emitted as a `p_params -> N` JSON accessor with an explicit
   cast, so values are data, never syntax.

`passimo_segment_*` are the only functions that run dynamic SQL, and each hard-
scopes to a single `business_id`.

A subtle bug worth recording: the recursive zod schema originally let an invalid
condition fall through the union and parse as an *empty group*, silently turning
`email = x` into "match everybody". Nested groups now require their own
`conditions`, and there is a test for it.

---

## 8. Messaging

```
campaign / automation / transactional
                  ↓
           dispatchMessage()          ← the only exit
                  ↓
  customer active? → destination? → consent? → suppressed?
  → frequency cap? → quiet hours? → render → provider
                  ↓
        messages row (sent | failed | skipped + reason)
```

Every reason a message must *not* be sent lives in one function. Campaign code
and automation code contain no compliance logic, and a new send path cannot omit
a check.

Skips are **recorded**, not swallowed. When a merchant asks why an audience of
800 received 540 messages, the campaign detail page breaks it down by reason.

Providers are thin adapters behind one interface and never throw — a failure is
a `SendResult`, so the caller can record it, classify it (permanent failures
auto-suppress) and retry.

`channel: 'auto'` tries wallet → email → whatsapp → sms: most reachable and
cheapest first, most intrusive last.

---

## 9. The job queue

A Postgres outbox, not Redis: one fewer piece of infrastructure, transactional
with the data that caused the job, and `FOR UPDATE SKIP LOCKED` lets many
workers run concurrently without contention.

```sql
passimo_claim_jobs(worker, limit)   -- atomic claim, skip locked
passimo_requeue_stalled_jobs()      -- recover after a worker dies
```

Retries use exponential backoff with jitter, capped at an hour, and a job that
exhausts `max_attempts` becomes `dead` rather than spinning forever.

The worker is bounded by both a job count and a **wall-clock budget** below the
function timeout, so it always returns cleanly and unfinished work is requeued
rather than abandoned mid-flight.

---

## 10. Automations

A small explicit state machine, not a workflow DSL — merchants need to be able
to predict what will happen:

```
trigger → enrol (cooldown checked atomically) → wait → re-check → act
```

Eligibility is checked **twice**: at enrolment and again at run time. The delay
can be days, and a win-back must not fire at someone who already came back. That
re-check is why `automation_runs` has a `skip_reason`.

Time-based triggers (birthday, anniversary, inactivity, expiry) have no
originating event, so a nightly sweep finds who became eligible today.

---

## 11. Analytics

`passimo_analytics_overview` answers the entire dashboard in **one** call. The
previous implementation issued eleven sequential round trips, six of them purely
to build a six-point chart.

Behavioural rollups (`visit_count`, `lifetime_spend`, `average_ticket`,
`days_between_visits`) are maintained per customer on write. That keeps segment
and analytics queries index-friendly instead of scanning the event table at read
time.

The churn model is a deliberately transparent heuristic: how overdue a customer
is relative to *their own* visit rhythm, damped by how much history exists.
Merchants act on numbers they can reason about, and the AI layer can quote it.

---

## 12. Frontend

- `WorkspaceProvider` holds "which business, what may I do here", so no
  component threads a `businessId` through five layers and permission checks are
  one call.
- `useApi` wraps SWR with one fetcher, one error type, one cache. Retries only
  on retryable statuses.
- `AsyncBoundary` renders loading / error / empty / content in one place, which
  is how "every screen has all four states" stays true rather than aspirational.
- Impure reads (`Date.now`, `localStorage`, feature detection) go through
  `lib/client/hooks.ts` via `useSyncExternalStore` — hydration-safe and free of
  setState-in-effect cascades.
- Tables become cards below `md`. A seven-column table is unusable on a phone,
  and merchants check this on a phone.

---

## 13. Deliberate non-goals

| Not built | Why |
| --- | --- |
| Visual workflow builder | Merchants will not maintain one. Eight great defaults beat infinite configurability. |
| Real-time websocket dashboard | The data changes a few times an hour. Polling on focus is enough and far cheaper. |
| Bundled WASM QR decoder | ~300 kB on a counter tablet to duplicate a native browser API. |
| Redis | Postgres already gives transactional enqueue and `SKIP LOCKED`. |
| Multi-currency per business | One currency per workspace covers the target market; the column exists when it does not. |
| Our own billing portal | Invoices, cards, VAT and dunning would mean PCI scope to rebuild a screen Stripe already does better. |
| Membership payment collection | Cafés and salons take the card at the counter. Forcing a Stripe subscription on that flow would kill adoption of the feature that drives the most retention; the model supports a `stripe_subscription_id` when a merchant wants one. |
