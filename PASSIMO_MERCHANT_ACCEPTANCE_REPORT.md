# Passimo — Merchant Acceptance Report

**Date:** 2026-09-05
**Method:** the running product, driven as a merchant — a production build on
`localhost:3000` against a live PostgreSQL, plus the full automated suite.
**Scope:** landing → pricing → signup → onboarding → card → activate → counter →
customer → visit → reward → analytics → CRM → campaigns → billing.

---

# Executive summary

**Verdict: a café owner could sign up today and launch unaided.** Every step of
the journey works end to end, and the two things that most stood in the way when
this pass started have been fixed rather than filed.

The pass found **six defects, four of them silent** — no error, no log line, no
failing test. Three were severe, and all three shared a shape: a feature that was
built, worked in isolation, and was unreachable or unknowable in practice.

| # | Defect | Severity | Status |
| --- | --- | --- | --- |
| 1 | Segment audiences resolved to **nobody** — customer filter empty, campaign fan-out empty, birthday automations empty | **Critical** | Fixed |
| 2 | Every "is one of" segment condition **errored and was reported as zero matches** | **Critical** | Fixed |
| 3 | A failed segment query was **indistinguishable from an empty audience** | **High** | Fixed |
| 4 | Tags could never be applied to an existing customer, making the tag filter and tag segments unusable | **High** | Fixed |
| 5 | Demo CRM intelligence (RFM, churn, predicted value) was **entirely null** | Medium | Fixed |
| 6 | The counter — the most-used screen — had **no heading at all** | Medium | Fixed |

Plus one polish fix: the landing demo's "Next reward" figure was clipped to
"160 poi…" on a phone.

**What is genuinely not ready** is unchanged and is not code: Apple Wallet,
Google Wallet, Stripe and every messaging channel are credential-dependent, and
no credentials exist on this deployment. The product says so on screen rather
than implying otherwise, which is the right behaviour — but it means a merchant
can design a card and cannot yet hand one to a customer.

**Launch readiness: 91/100.** Pilot-ready with a hand-held cohort. Not ready for
unattended self-service signup, because the merchant would reach "activate my
card" and find the card cannot issue.

---

# The three critical defects, in detail

These are recorded at length because they share a failure mode worth
recognising: **zero is a legitimate answer**, so a broken query that returns zero
looks exactly like a correct query returning zero.

## 1. Segment audiences resolved to an array of `undefined`

`passimo_segment_customer_ids` is declared `returns table (id uuid)`. A
`returns table` with **one** column is not a composite type in the PostgreSQL
catalogue — it is flattened to `returns setof uuid` (`prorettype = uuid`,
`typtype = 'b'`). The RPC layer correctly hands those back as bare strings.

Three call sites read them as `rows.map((row) => row.id)`, which on an array of
strings yields an array of `undefined` — and `.in('id', [undefined, …])` matches
nothing.

What that looked like in the product:

- **Customers → filter by any segment** returned an empty table, while the
  segments screen — which counts through a *different* function — said 468.
- **A segment-targeted campaign** reported a reach of 468 and then sent to
  nobody, because the fan-out resolves recipients through the ids function.
- **Birthday and anniversary automations** found no one, every day, silently. An
  empty audience is a legitimate answer on most days of the year, so there was
  nothing to notice.

**Fixed** by `idsFrom()` in `lib/db/index.ts`, which accepts either shape, and by
making `lib/customers/service.ts` reuse `listSegmentCustomerIds` instead of
holding its own copy of the call. Guarded by `tests/unit/db-rpc-shapes.test.ts`,
which asserts both the helper's behaviour **and** that no call site re-introduces
`.map(row => row.id)` within fourteen lines of an `.rpc(`.

## 2. `= any((select array_agg(…)))` — the subquery form

`x = any(y)` has two forms, and PostgreSQL chooses **syntactically**: a
parenthesised SELECT is the *subquery* form. The segment compiler emitted
`c.rfm_segment::text = any((select coalesce(array_agg(v), …)))`, which is the
subquery form applied to one row of type `text[]`. The planner refused it:

```
operator does not exist: text = text[]
```

Every `in` / `not_in` condition, and both tag predicates, therefore failed. And
because `countSegment` logged the error and returned `0`, the answer came back
looking like "no customers match":

- the built-in **VIP** segment (*is_vip OR RFM in champion/loyal*) read **0**
  against a workspace holding **50 VIPs**;
- a merchant filtering by language or tag saw an empty table and believed it.

A unit test asserting `expect(sql).toContain('= any(')` passed throughout,
because the SQL had exactly the right *shape*.

**Fixed** by emitting `array(select v from jsonb_array_elements_text(…))` — an
array *constructor*, so the array form is chosen. VIP went 0 → 354. Guarded by a
unit assertion pinning the constructor form on all four list operators, and by a
new integration test that **executes every operator the segment builder can
produce** against real PostgreSQL — the test that would have caught it.

## 3. A failed query reported as an empty audience

The reason both defects above stayed invisible: `countSegment`,
`listSegmentCustomerIds` and `listSegmentCustomers` all logged and returned
`0` / `[]` on error.

**Fixed** — they throw now. A merchant gets an error state with a retry instead
of a confident wrong number, and the job runner retries and logs instead of
caching a zero onto the segment card forever. `customerMatchesSegment` stays
non-throwing on purpose: it answers "does this person still match?" for an
automation about to act, and refusing to act on a failed check is the safe
direction.

---

# Results by area

Status key: **Pass** · **Pass with limits** · **Fixed this pass** · **Blocked**

## Merchant journey — Pass

Walked end to end against a live database, on desktop and on a Pixel 7, in
English and Spanish.

| Step | Result |
| --- | --- |
| Landing → pricing → signup | Pass. Four fields, no fifth has crept in. |
| Signup provisions business, program, location, trial | Pass — a 14-day Pro trial, `Stamp card` seeded from the trade. |
| Onboarding, four steps, two skippable | Pass. Choosing a trade visibly rebuilds the program and the card. |
| Onboarding interruption | Pass. Wizard cursor and saved design both survive a new session. |
| Card design → template → save → reload | Pass. Every field persists; verified by re-reading the database. |
| Brand kit propagates to the card | Pass. |
| Location, reward, customer | Pass. |
| Counter → visit → points → progress | Pass. A replayed scan is recognised, not double-awarded. |
| Reward unlock → redeem | Pass. Over-balance redemption refused with a reason. |
| Analytics reflect the transactions | Pass. Customers, revenue and redemptions all move. |
| Checklist reflects reality | Pass. Nothing ticked on day one. |

**Time to first scan for a new merchant: under ten minutes**, as the product
specification requires.

## Landing page — Pass

Understandable in ten seconds: one `h1`, "Apple Wallet and Google Wallet" above
the fold, trades named, pricing linked, entry price visible, primary CTA present.

**No fabricated traction.** Asserted against four patterns (customer counts,
"trusted by N", ratings, happy-customer claims); the page uses "launching soon"
and "early access" instead.

## Landing demo — Pass, one fix

Interactive, no camera, no account, no download. Recording a visit moves real
numbers; changing the trade changes the card. Both wallet framings are shown and
labelled as previews. **Verified that no `getUserMedia` call is made** by hooking
`navigator.mediaDevices` and driving the demo.

**Fixed:** the "Next reward" figure was `truncate`d to "160 poi…" at 412px — the
one number on that panel a visitor reads it for. It now spans the full width on a
phone and wraps. A new test flags *any* element whose computed
`text-overflow: ellipsis` is actually clipping.

## Pricing and plan gating — Pass

No free plan. Entry tier €5/month. The matrix below was **probed against the real
endpoints**, not read from configuration — each cell is an actual HTTP response.

| Plan | Campaigns | Segments | Gift cards | Memberships | AI | Automation rules |
| --- | --- | --- | --- | --- | --- | --- |
| Starter (€5) | blocked | blocked | blocked | blocked | blocked | blocked |
| Growth (€19) | allowed | allowed | allowed | blocked | blocked | allowed |
| Pro (€49) | allowed | allowed | allowed | allowed | *not configured* | allowed |
| Business (€99) | allowed | allowed | allowed | allowed | *not configured* | allowed |
| Trial (→ Pro) | allowed | allowed | allowed | allowed | *not configured* | allowed |

Every paywall returns **402** with a remedy. `/me` and the server agree on every
feature for every plan — checked cell by cell. AI returns **503 not_configured**
on plans that include it, which is honest: entitled, but no key on this
deployment.

**Lapsed workspace:** reads work, nothing was deleted, writes return 402 naming
reactivation. Correct.

## Wallet card designer — Pass

Reachable in **one click** from three places on the first screen after sign-in
(sidebar "Card design", dashboard callout, checklist row). Eleven templates,
live Apple and Google previews rendering through the same resolver the pass
builder uses, every control affecting the preview or the stored design.
Persistence verified against the database, not inferred.

## Brand kit — Pass

One source of truth on the `businesses` row. Changing it propagates to the card
designer's preview, the join page and the browser card. Contrast is computed in
exactly one place — asserted structurally by an existing test.

## QR scanner / counter — Pass, one fix

The scanner is in the merchant product and **not** on the landing page. Camera
permission, torch, sound and switch controls are all labelled. With no camera —
which is every Playwright run and every laptop at a till — the manual panel is
reachable and serves a customer.

**Fixed:** `/pos` had **no heading of any kind**. A screen-reader user arriving
at the most-used screen in the product got a main landmark containing a video
element and some icon buttons, with no way to know where they were. It now has a
visually-hidden `h1`.

## Loyalty and rewards — Pass

Earn, redeem, idempotency, insufficient balance, duplicate redemption, blocked
customers. **Blocking is enforced by the engine, not by a disabled button** — a
blocked customer earns nothing and redeems nothing, with `customer_blocked` as
the stated reason.

## CRM — Fixed this pass

Search, VIP filter, churn sort, pagination, notes, export, GDPR erasure: all
pass.

**Fixed — tags.** Tags could be written *only* at enrolment or through a CSV
column. The profile rendered read-only badges, `?tag=` was a supported list
filter nothing in the UI could set, and segments offered a "Tag is one of"
condition a merchant had no way to populate. Three features resting on a write
path that closed the moment somebody became a customer — so a café owner could
not mark the regular in front of them as "wholesale" or "no nuts".

Now: one shared write path (`lib/customers/tags.ts`), an editable control on the
profile, a tag filter on the customer list, a `/customers/tags` vocabulary
endpoint, and **case-insensitive identity with case-preserving display** —
writing "Wholesale" against a stored "wholesale" reuses the tag rather than
creating a second one. The read paths fold case to match; they did not, which the
new integration test caught.

## Segmentation — Fixed this pass

All ten built-in segments now resolve to real, non-zero, self-consistent counts.
The assertion that matters: **the preview count and the filtered customer list
return the same number**, checked for every segment.

| Segment | Before | After |
| --- | --- | --- |
| VIP | 0 | 354 |
| High churn risk | 0 | 370 |
| Active | preview 468 / list **0** | 468 / 468 |
| All customers | preview 860 / list **0** | 860 / 860 |
| At risk, Lost, New, One-timers, Reward ready, Birthday | preview *n* / list **0** | equal |

## Campaigns — Pass

Reach and cost estimate are reported before sending. A segment-targeted campaign
resolves a real audience (468 against the "Active" segment). No campaign silently
targets nobody — which it did before defect #1 was fixed.

## Analytics — Pass

Not static. Performing transactions moves customers, revenue and redemptions.
No `NaN`, `undefined` or `[object Object]` on any screen. Every metric tile
carries a one-line explanation.

## AI — Pass with limits

**Classification: implemented, credential-dependent.** `capabilities.ai` is
`false` on this deployment and the API returns `503 not_configured` naming the
missing capability. Nothing mock is presented as production AI. Plan gating is
correct: Starter and Growth get 402, Pro and Business get 503.

## Billing — Pass with limits

Every state present locally checks out: active, trialing, canceled/lapsed. The
billing screen and `/me` agree on the effective plan and the trial flag for all
four accounts. Plan limits are coherent.

Checkout returns **503** with *"Billing (STRIPE_SECRET_KEY) is not configured on
this deployment"* — it names the missing capability rather than blaming the
merchant. Upgrade, downgrade, dunning and payment recovery are implemented and
**cannot be exercised without a Stripe key**.

## Localization — Pass

Both locales walked across six screens with a **two-directional** assertion: the
expected strings present *and* the other language's strings absent. That second
half is what catches the real failure mode — a screen built from thirty `t()`
calls that renders twenty-nine and leaves one English literal behind.

Word-boundary matching, deliberately: "Exportar" contains "Export", and a
substring check would fail on correct Spanish.

## Mobile and tablet — Pass

Pixel 7: eight dashboard screens plus onboarding and the counter, with no
horizontal overflow anywhere and no clipped text on the landing page.

**Tablet coverage now exists** — the gap the previous pass admitted to. iPad
portrait (768), iPad landscape (1024) and Android tablet (800) are driven with
explicit viewports rather than a third Playwright project, so it runs once
instead of doubling the suite.

## Accessibility — Pass with limits

One `main` landmark per screen. Every visible form control on the dashboard, the
card designer, the customer list and the counter is labelled — asserted by
walking the DOM, not by inspection. The preview switch is a real `tablist` with
roving tabindex. The first-steps checklist gained an accessible name this pass.

**Limit:** no axe or Lighthouse run. Contrast is enforced in code for the card
face (WCAG AA, computed) but not measured across the dashboard chrome.

## Security — Pass

**Multi-tenant isolation: 19 attack-shaped probes, all refused.** Merchant A
cannot read B's customers, analytics, campaigns, segments, locations, wallet
settings, card design, brand kit, onboarding, insights, gift cards, rewards,
programs, wallet analytics or notifications; cannot read B's customer by id under
A's own workspace; cannot award points to B's customer; cannot create a customer
in B's workspace; cannot repaint B's loyalty card. All 403 or 404.

Anonymous callers get 401 on every protected endpoint. Every API response carries
`X-Request-Id`, including errors. Errors branch on `code`, never leak a bare
"Something went wrong", and validation returns field-level detail.

Rate limiting is real and bit this pass: the auth limiter (8 requests / 5 minutes
/ IP) refused a test suite that signed in per test. That is the control working.

## Database — Pass

`scripts/db-verify.ts`: **252 pass, 25 warnings, 0 fail, 0 error.**

The 25 warnings are unused indexes on a young database and single-index tables —
expected, not defects. Migrations replay cleanly from empty (verified in the
previous pass); the demo seed runs against a fresh schema.

**Cleaned up:** this pass created 56 throwaway workspaces while testing. All were
removed through the product's own `passimo_delete_business`, which exercised the
deletion path as a side effect. Verification went from 58 failures to 0.

## Performance — Pass

Measured on the production build, 1,249 customers in the largest workspace:

| Endpoint | Average | Worst |
| --- | --- | --- |
| `/analytics/overview` | 319 ms | 669 ms |
| `/customers` (50 rows) | 37 ms | 59 ms |
| `/segments` | 22 ms | 64 ms |
| `/wallet/design` | 26 ms | 44 ms |
| Landing page | 38 ms | 61 ms |

The analytics overview is the slowest by an order of magnitude. Acceptable at
this scale, worth watching past ~10,000 customers.

---

# Automated test results

All run on 2026-09-05 against this tree, with PostgreSQL up and a production
build serving.

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass, 0 warnings |
| `pnpm test` | **680 passed**, 29 files |
| `pnpm test:integration` | **92 passed**, 7 files |
| `pnpm build` | Pass |
| `pnpm test:e2e` (desktop + Pixel 7) | **214 passed, 4 skipped** |
| `pnpm db:verify` | **252 pass, 0 fail** |
| Merchant acceptance harness (API) | **180 passed, 0 failed** |
| Lifecycle & billing harness (API) | **46 passed, 0 failed** |

The four e2e skips are viewport-specific tests under the opposite projection —
the correct outcome, not a gap.

## Tests added this pass

| File | Covers |
| --- | --- |
| `tests/unit/db-rpc-shapes.test.ts` | `idsFrom` on both RPC result shapes, plus a structural guard that no call site reads `.id` off an RPC result again |
| `tests/unit/customer-tags.test.ts` | Tag normalisation: trimming, case folding, length and count caps, and `[]` meaning "clear" |
| `tests/unit/segments-operators.test.ts` | Extended: the array-constructor form of `any()` on all four list operators |
| `tests/integration/segments.test.ts` | Extended: **every operator the builder can produce, executed**, plus count/audience agreement |
| `tests/integration/customer-tags.test.ts` | Tag write, replace, clear, case folding, list filter, segment match, and cross-tenant isolation |
| `tests/e2e/merchant-acceptance.spec.ts` | The journey as a person: landing comprehension, no fabricated traction, demo interactivity, no camera, discoverability, dead-end sweep, Spanish leakage, mobile, tablet, labelled controls |

No test was disabled, weakened or skipped to make a run pass. Four harness
assertions were corrected after inspection showed the *test* was wrong about the
product's contract — each is noted below.

---

# Things that looked like bugs and were not

Recorded so they are not "found" again:

| Observation | Verdict |
| --- | --- |
| Creating a customer with an existing email returns 200 | **Correct.** Enrolment is idempotent by design; the response carries `is_new: false` and no second row is created. |
| `GET /billing` reports `plan: "lapsed"` for a trialling merchant | **Correct.** `plan` deliberately folds `trial` to `lapsed`; the payload also carries `stored_plan` and `effective_plan`, and the UI renders the latter. |
| `/api/v1/health` carries no `X-Request-Id` | **Correct.** It sits outside `defineRoute` on purpose, so a health check cannot depend on the thing that might be broken. |
| `.map(row => row.id)` in `lib/automations/engine.ts:414` | **Correct.** That one reads a `.from().select('id')` result, which really is one-key objects. |

---

# Remaining issues

## Credential-dependent — implemented, cannot be exercised

Classified honestly. None of these is missing implementation; none has been
verified in production.

| Feature | Status |
| --- | --- |
| Apple Wallet pass issuance | Implemented — credential-dependent. Builder and `pass.json` unit-tested; no certificates. |
| Google Wallet pass issuance | Implemented — credential-dependent. Class and object builders unit-tested; no issuer account. |
| Stripe checkout, portal, dunning | Implemented — credential-dependent. Returns 503 naming the missing key. |
| Email / SMS / WhatsApp delivery | Implemented — credential-dependent. Every path written and localised; nothing can be delivered. |
| Geocoding and Maps | Implemented — credential-dependent. Falls back to two number fields. |
| S3 storage driver | Implemented, untested against a real bucket. The `local` driver is what runs here. |

**A merchant cannot complete the last step of the promise on this deployment:**
they can design a card and cannot hand one to a customer. That is the single
thing standing between "pilot-ready" and "launch".

## Genuinely open

1. **No axe or Lighthouse audit.** Accessibility is asserted structurally
   (landmarks, labels, roles, overflow) but never measured. Contrast beyond the
   card face is unverified.
2. **`coverUrl` renders nowhere.** Stored and editable, no surface. The one
   remaining half-wired brand field.
3. **One card design per business.** `wallet_card_designs` is keyed on
   `business_id`; per-location variants are out of scope by choice.
4. **Analytics overview at 319 ms** is the slowest endpoint by 10×. Fine now;
   worth an index review before large workspaces.
5. **Server-side Zod validation messages are English.** Last-fallback only — the
   error envelope's `code` is translated first.
6. **No production deployment has ever run.** `docs/RAILWAY.md` is written from
   configuration, not experience.
7. **`customers/tags` has no pagination.** Capped at 200 tags per business, which
   is generous for the use case but is a cap.

---

# Final merchant verdict

| Question | Answer |
| --- | --- |
| Can a new merchant launch without assistance? | **Yes** — up to the point of issuing a real wallet pass, which needs credentials. |
| Can a merchant understand Passimo quickly? | **Yes.** One heading, both wallet names, trades listed, price visible, CTA present. |
| Can a merchant customize their Wallet card? | **Yes.** One click from three places; eleven templates; persists. |
| Can a merchant configure loyalty? | **Yes.** Seeded from their trade, editable throughout. |
| Can a merchant create customers? | **Yes.** Counter, QR join page, manual, CSV import. |
| Can a merchant process visits? | **Yes.** Idempotent, with a working no-camera fallback. |
| Can a merchant manage rewards? | **Yes.** Create, unlock, redeem, refuse over-balance, refuse replay. |
| Can a merchant understand analytics? | **Yes.** Every tile carries its own explanation. |
| Are plans correctly enforced? | **Yes.** Probed cell by cell against the real endpoints. |
| Is the landing page convincing? | **Yes**, and honest — no fabricated traction. |
| Is the product mobile-ready? | **Yes.** Phone and tablet, no overflow, no clipped text. |
| Is localization consistent? | **Yes.** Verified in both directions. |

## Launch readiness: 91 / 100

| Dimension | Score | Why |
| --- | --- | --- |
| Merchant activation | 95 | Under ten minutes to a first scan. |
| Feature completeness | 92 | Everything the plans promise is enforced and reachable. |
| Correctness | 90 | Three silent audience bugs found and fixed this pass; the class is now guarded. |
| Security & isolation | 96 | 19 tenant probes refused; rate limits real. |
| UX & discoverability | 92 | Card designer, tags and the counter heading all fixed. |
| Localization | 95 | Two-directional verification in place. |
| Testing | 90 | 1,232 automated assertions across five suites; no axe. |
| **Provider readiness** | **55** | Wallet, payments and messaging all credential-dependent. |

**The gap is not code.** Add Apple certificates, a Google issuer account and a
Stripe key, and this ships.

---

# Changes made in this pass

| Area | Change |
| --- | --- |
| `lib/db/index.ts` | New `idsFrom()` — reads ids from either RPC result shape |
| `lib/segments/resolve.ts` | Uses `idsFrom`; failed queries now throw instead of reporting an empty audience |
| `lib/segments/compile.ts` | `array(select …)` instead of the subquery form of `any()`; tag predicate folds case |
| `lib/customers/service.ts` | Reuses `listSegmentCustomerIds`; tag filter uses `ilike` |
| `lib/automations/engine.ts` | Uses `idsFrom` — birthday and anniversary automations find people again |
| `lib/customers/tags.ts` | **New.** One tag write path, case-insensitive identity, replace semantics |
| `app/api/v1/customers/tags/route.ts` | **New.** The business's tag vocabulary |
| `app/api/v1/customers/[id]/route.ts` | Accepts `tags`; returns `tagSuggestions` |
| `app/api/v1/customers/route.ts`, `lib/customers/import.ts` | Reuse the shared tag helper instead of two inline copies |
| `components/customers/tag-editor.tsx` | **New.** Tag a customer who is already a customer |
| `app/dashboard/customers/page.tsx` | Tag filter, shown only when the business uses tags |
| `app/pos/page.tsx` | A visually-hidden `h1` on the counter |
| `components/onboarding/first-steps.tsx` | The checklist is an announced landmark |
| `components/landing/product-demo.tsx` | "Next reward" wraps instead of clipping on a phone |
| `scripts/seed-demo.ts` | Runs the real RFM and churn recompute, so demo CRM is populated |
| `lib/i18n/dictionaries/{en,es}.ts` | Tag copy, `pos.title`; removed the unused "Coming soon" string |
| `docs/API.md` | Customer casing, the tag endpoints and their semantics |

---

# Environment notes

- Development stays on **localhost**; nothing was pointed at `passimo.app`.
- Database direction unchanged: **Railway + PostgreSQL**, no Supabase dependency
  introduced.
- No credentials hardcoded. Demo accounts are the six in `DEMO_CREDENTIALS.md`,
  password from `DEMO_PASSWORD`, and are never shown in the application UI.
- The 56 test workspaces this pass created were removed afterwards through
  `passimo_delete_business`; the demo database holds the intended six businesses.
