# AI audit — Passimo

**Date:** 2026-09-08
**Scope:** every AI surface in the product — the client, the seven capabilities,
the route that fronts them, the daily job, the data they send, and the claims
made about them in product copy and the privacy policy.
**Method:** source review, then assertions written against a mocked SDK and
against the source itself, then HTTP probes against a running build. No live
provider call — see [Still unverified](#still-unverified), which is the most
important section of this document.

---

## Verdict

The AI architecture is real, narrow, and better-governed than most: one endpoint,
forced structured output with schema validation, per-tenant metering, honest
behaviour with no credential, and nothing written to a merchant's data without a
person choosing it. Nothing was faked, and no hardcoded "AI-looking" output
exists anywhere in the codebase.

It also would not have worked. **Three of the seven capabilities would have
returned a 400 on their first real request**, and the reason nothing surfaced it
is structural rather than careless.

Eight findings, all fixed. One accepted limitation.

---

## Findings

### AI-1 — Launch blocker: every request sent a rejected parameter

**Severity:** critical · **Status:** fixed

Every call passed `temperature`. Sampling parameters were removed from the
Sonnet 5 / Opus 4.7+ generation — a non-default `temperature`, `top_p` or `top_k`
is an **invalid request**, not a hint the model ignores. The configured default
model is `claude-sonnet-5`.

Three things hid it, and they are worth stating because the same three will hide
the next one:

1. **No credential locally.** Without `ANTHROPIC_API_KEY` every call stopped at
   `notConfigured` long before it reached Anthropic. The honest
   credential-absent behaviour the product is rightly proud of was also what
   kept a launch blocker invisible.
2. **It was selective.** Four capabilities pass `fast: true` and run on Haiku
   4.5, which still accepts `temperature`; those worked. The three on the
   default model — campaign generation, the daily insight feed, program
   optimisation — would have failed.
3. **Nothing asserted the request.** The suite tested prompt builders and
   schemas, never the object handed to the SDK.

**Fix.** `temperature` is gone from `GenerateOptions` entirely rather than
defaulted — an option that silently 400s is worse than no option. The four
capabilities that set one were expressing real intent (determinism for the
segment compiler, warmth for a customer summary); that intent now lives in the
prompt text, which is where current guidance puts it. A `MODEL_TRAITS` table in
`lib/ai/client.ts` is now the one place that knows about per-generation request
shape.

**Evidence.** `tests/unit/ai-client.test.ts` — no `temperature`, `top_p` or
`top_k` on either model, asserted against a mocked SDK.

---

### AI-2 — Default-on thinking could consume the whole token budget

**Severity:** high · **Status:** fixed

On Sonnet 5, a request that omits `thinking` runs with adaptive thinking, and
`max_tokens` caps thinking *plus* response text together. These calls are
deliberately short — 350 to 2,000 tokens — and five of the seven force a tool
call. A turn that spent its budget thinking would return **no `tool_use` block
at all**, surfacing as "Model did not return structured output": a schema error
for what is actually a truncation.

**Fix.** `thinking: { type: 'disabled' }` is sent where the model both thinks by
default and accepts the disable. Haiku 4.5 predates that shape — it does not
think unless given a `budget_tokens` — so the correct request omits the field
rather than sending a disable it may not recognise. Sending one shape to both
models is how a fix for one becomes a 400 on the other.

An unrecognised `ANTHROPIC_MODEL` gets `DEFAULT_TRAITS`: the minimal four-key
request, which is the shape most likely to be valid on a model nobody has
characterised.

**Evidence.** Same file — `thinking` present on Sonnet, absent on Haiku, absent
for `some-future-model-v9`, which also gets exactly four request keys.

---

### AI-3 — A missing credential was reported as a provider outage

**Severity:** high · **Status:** fixed

`anthropic()` throws `notConfigured`, and because that call sat inside the `try`,
the `catch` wrapped it in `upstreamFailed('Anthropic')`. A deployment that had
simply never been given an API key reported **"Anthropic request failed"** — a
fabricated outage, logged at error, for a configuration fact.

The API routes guard on `env.ai.isConfigured` first, so the documented
`503 not_configured` behaviour survived *at the edge*. The library underneath it
did not, which meant the contract held by luck: the next call site that forgot
the guard would have reported an outage instead of a missing key. Found by a
test written to assert the contract, not by reading the code.

**Fix.** `asAiError()` passes an `AppError` through untouched and wraps only what
came from the provider or the transport. `not_configured` is additionally
rethrown before the error log, because paging on a missing credential trains
people to ignore the channel where real provider failures arrive.

---

### AI-4 — Our own diagnostic was discarded

**Severity:** medium · **Status:** fixed

"Model did not return structured output" sent the last person who read it to
look at the schema, when the usual cause is the token budget. A `stop_reason` was
added to distinguish them — and it never reached a log, because `upstreamFailed`
builds a fixed message and keeps the original only as `cause`.

**Fix.** The diagnostic *is* the `upstreamFailed` label:
`upstreamFailed(\`Anthropic (no tool call, stop_reason: ${…})\`, response)`.
`max_tokens` now means the budget ran out; anything else means the model
declined.

**Evidence.** A test asserts `max_tokens` appears in the thrown error.

---

### AI-5 — The customer summary sent personal data it never used

**Severity:** high · **Status:** fixed

`summarizeCustomer` selected `name` *and* `first_name`, plus `birthday`, and sent
all of it to Anthropic. The prompt says "use only the first name" and the model
never referenced the date of birth. So a full legal name and a date of birth
were disclosed to a third-party processor in order to be ignored.

Nothing at runtime distinguishes that from correct behaviour — models ignore
fields happily. The only place it is visible is the `select()`.

**Fix.** Both columns removed. `tests/unit/ai-data-flow.test.ts` asserts at
source that no AI `select` contains `email`, `phone`, `postal_code`, `address` or
`birthday`, and that `first_name, name,` does not appear. `email` deserves the
explicit check: it is the primary key of a customer in this product, so a summary
including it would make every AI request a disclosure of the merchant's customer
list.

---

### AI-6 — Two cross-tenant reads in the summary path

**Severity:** high · **Status:** fixed

`summarizeCustomer` fires three queries concurrently. The tenant check lived only
on the customer row, so it could not protect the other two — they had already
run. The activity and notes queries filtered on `customer_id` alone, meaning a
caller who supplied a customer id belonging to another tenant would have had that
customer's activity and staff notes read and sent to the provider.

RLS is the backstop, and the application must not depend on the backstop.

**Fix.** `.eq('business_id', businessId)` added to both. The test asserts that
every `.eq('customer_id', …)` in the file has a `business_id` filter within a few
lines of it, so a fourth concurrent query cannot reintroduce this.

---

### AI-7 — Seven prompt inputs were undelimited

**Severity:** medium · **Status:** fixed

Staff notes, survey comments, segment names, the merchant's campaign brief and
their segment request were interpolated straight into prompts. "Our own merchant
typed it" is not a trust argument: staff notes, customer names and segment names
can all arrive through **CSV import**, and survey comments are written by the
public.

**Fix.** An `untrusted(label, value)` helper wraps all seven inputs in
`<untrusted_data source="…">`, and the system prompt states that such a block is
evidence and never an instruction. Both halves matter — the tag is inert without
the instruction.

**Evidence.** The test asserts all seven labels by name (so replacing the helper
cannot silently drop the contract), that every `JSON.stringify` interpolation is
either inside the helper or the SQL-generated anomalies block, and that the
system prompt still explains what the tag means.

---

### AI-8 — Two AI claims in product copy were not true

**Severity:** medium · **Status:** fixed

**The Pro tier highlight** read *"Daily AI insights, churn prediction and program
optimisation"*. Two problems in one line: churn risk is a deterministic SQL
score, not a prediction and not AI; and both daily insights and churn risk are
gated on `advanced_analytics`, which **Growth already includes** — so a Pro
differentiator was advertising two things the tier below already has. Replaced
with real, unclaimed Pro headroom from the frozen plan catalogue: 50,000 messages
a month and 100 automation rules, against Growth's 15,000 and 20.

**The privacy policy** stated that six of the seven AI features send aggregates
only, with the customer summary as the sole exception. That was wrong, and it was
wrong in a document where being wrong matters most: `analyzeFeedback` sends up to
**150 survey comments verbatim**. Free text cannot be grouped into themes without
being read, so there is no aggregate version of that feature. The policy now says
five of seven, names both exceptions, and says plainly that a comment is whatever
the person typed — including a name, if they signed it.

Everything else was checked and is accurate. "AI insights", "AI spotted" and "AI
assessment" all label genuine model output: `ai_insights` rows only ever come
from `generateInsights`, and nothing deterministic is filed there.

---

## What was already right

Worth recording, because an audit that only lists faults misrepresents the thing
it audited.

- **No fabrication anywhere.** No hardcoded AI responses, no random
  "AI-looking" text, no fake provider calls, no invented model names, no silent
  fallback to static content. A feature that cannot run says so.
- **One endpoint.** Seven capabilities behind one route means one rate limit, one
  permission check and one meter — rather than seven endpoints each having to
  remember all three. A new capability is governed by construction.
- **Metering after the answer.** One action, one unit, counted only once the
  model responded, so a provider outage never burns a merchant's allowance.
- **Structured output is forced, then validated twice.** JSON Schema constrains
  what may come back; a Zod parse decides whether it is usable. A validator that
  throws propagates rather than yielding a half-populated object.
- **AI output is never application state.** Campaigns arrive as editable drafts;
  a proposed segment is compiled and counted by SQL before the merchant sees a
  number, so the count on screen is the database's answer.
- **Availability derives from the credential**, not from a flag someone can set.
- **Query caps everywhere.** Prompt size is bounded by explicit limits rather
  than by hoping tenants stay small.
- **The daily job is gated and metered** like everything else, and degrades to
  `{ skipped: 'ai_allowance_exhausted' }` rather than throwing.
- **No secret is hardcoded.** `ANTHROPIC_API_KEY` is read from the environment
  and is optional.

---

## Still unverified

**No `ANTHROPIC_API_KEY` is configured in this repository or its verification
environment, so no live model call has ever been executed here.** Every claim in
this audit is verified structurally — request shape against a mocked SDK, data
flow against the source, guard ordering over HTTP — and structural verification
cannot answer the following:

| # | Unverified | Why it matters |
|---|---|---|
| 1 | That Anthropic accepts the exact request we now build | This is precisely the class of defect AI-1 was. A mock cannot reject an invalid request. |
| 2 | Output quality for all seven prompts | Whether a generated campaign is *good*, whether insights are worth reading, whether the segment builder maps ordinary sentences correctly. |
| 3 | Real token cost per capability | The allowances (25 / 300 / 1,500) were set from estimated prompt sizes, not measured usage. |
| 4 | Real latency against `maxDuration = 60` | The bounded `max_tokens` make a timeout unlikely, not impossible. |
| 5 | Provider error bodies — 429, 529, 400 | The retry and wrapping paths are exercised only with synthetic errors. |
| 6 | That Zod validators accept real model output | The schemas are asserted against fixtures we wrote. A real model may return a shape a validator rejects, which surfaces to a merchant as a failure. |

### The first hour after a key is configured

In order, because each step's failure mode is different:

1. One call per capability, on both models, response recorded. That closes 1, 2
   and 6 for the paths that matter most.
2. Record input and output tokens per capability, then re-check the monthly
   allowances against the measured numbers rather than the estimates. Closes 3.
3. Time the three Sonnet capabilities against the 60-second limit. Closes 4.
4. Force a 429 and a schema mismatch deliberately, and confirm the merchant sees
   a comprehensible message rather than a stack trace. Closes 5 and the
   remainder of 6.

Until step 1 is done, "AI is production-ready" is not a claim this repository can
support, and no document in it should make one. The architecture is ready. The
integration is untested against the provider.

---

## Addendum — independent re-verification, 2026-09-10

The audit above was written on 2026-09-08. The machine running the follow-on
work shut down on 2026-09-09 at 16:51:36, mid-edit. On recovery, every claim in
this document was re-checked against current source rather than accepted, and
the model facts were re-checked against the current Anthropic model catalogue.

**All eight findings verify as fixed.** Specifically confirmed:

- `temperature`, `top_p` and `top_k` appear nowhere in `GenerateOptions` or in
  either request path (AI-1).
- `thinking: { type: 'disabled' }` is sent on Sonnet 5 and omitted on Haiku 4.5
  (AI-2). Both are the correct shape for their model.
- `asAiError()` passes an `AppError` through untouched; `not_configured` is
  rethrown before the error log (AI-3).
- The `stop_reason` reaches the thrown error's label (AI-4).
- No AI `select` contains `name`, `email`, `phone`, `birthday`, `postal_code` or
  `address`; `summarizeCustomer` selects `first_name` only (AI-5).
- Every `.eq('customer_id', …)` in `capabilities.ts` has a matching
  `.eq('business_id', …)` — lines 582/594 and 600/601 (AI-6).
- All seven user-authored inputs pass through `untrusted()`, and the system
  prompt still explains what the tag means (AI-7).

**Model lifecycle, re-checked:** `claude-sonnet-5` and
`claude-haiku-4-5-20251001` are both **active** — neither deprecated nor
retired. The `MODEL_TRAITS` table is accurate for both, including the
`claude-opus-5` row (disabling thinking is legal only at effort ≤ `high`, and
no `effort` is sent, so the default `high` keeps it legal).

**The credential-absent contract, verified live** rather than structurally.
Against the running application, for a plan entitled to AI:

```
PASS  pro MAY use ai.generate (ai)
      → HTTP 503 not_configured
      → "AI features is not configured on this deployment"
```

**One new finding, not present in the audit above.**

`meterAction` is a check-then-act with no lock held across the provider call.
The code calls this acceptable "because the cost of briefly exceeding a soft
quota is zero" — true for `customers` or `locations`, and **not true for
`ai_actions`, where every unit of overshoot is a billable inference call.**
Nothing tested it, so it was measured:

```
[ai meter] burst=8 remaining=3 sold=7 used=29/25 overshoot=4
```

Eight concurrent requests with three units remaining sold seven and overshot by
four. The meter never under-counts, and once the counter is durably past the cap
a burst is refused in full with zero provider calls — so the exposure is a
one-off overshoot per period, bounded in production by the route's own rate
limit (`ai`: 30/hour). Covered now by
`tests/integration/ai-metering-concurrency.test.ts`.

A related second-order issue: `trackUsage` swallows RPC failures, so a
successful AI call whose metering write fails is never counted. Neither
behaviour was changed — both are fail-open/fail-closed product decisions rather
than defects to silently flip during a recovery audit. Both are carried into
`PASSIMO_LAUNCH_READINESS_AUDIT.md` with recommendations.

**"Still unverified" above remains entirely accurate.** No live provider call
has been executed. That is still the single thing standing between this
architecture and a supportable production claim.

---

## Files

| File | Role |
|---|---|
| `lib/ai/client.ts` | Provider client, model traits, structured output, error taxonomy |
| `lib/ai/capabilities.ts` | The seven capabilities, prompts, schemas, `untrusted()` |
| `app/api/v1/ai/route.ts` | The single endpoint and all six gates |
| `lib/jobs/handlers.ts` | `generateAiInsights`, the only background AI |
| `lib/env.ts` | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_FAST_MODEL` |
| `lib/billing/plans.ts` | Monthly `ai_actions` allowances |
| `tests/unit/ai-client.test.ts` | 9 tests — request shape against a mocked SDK |
| `tests/unit/ai-data-flow.test.ts` | 6 tests — data sent, asserted against source |
| `docs/AI_ARCHITECTURE.md` | How it works |
| `docs/AI_REALITY_MATRIX.md` | Per-feature: AI or arithmetic, and what is sent |
