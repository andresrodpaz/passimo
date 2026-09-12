# AI architecture

How the AI features in Passimo are built, what governs them, and where the
boundaries are. Written from the code, not from an intention — every claim here
names the file it comes from so it can be checked.

The companion documents are [`AI_REALITY_MATRIX.md`](./AI_REALITY_MATRIX.md),
which says feature by feature what is a model call and what is arithmetic, and
`../AI_AUDIT_REPORT.md`, which records what was wrong and what is still
unverified.

---

## The short version

Seven features call a language model. All seven go through one endpoint, one
client and one meter. There is no second path, no background AI except a single
daily cron, and no fallback that invents an answer when the provider is absent.

```
POST /api/v1/ai  ──►  lib/ai/capabilities.ts  ──►  lib/ai/client.ts  ──►  Anthropic
   (7 actions)          prompt + schema             request shape         API
        │
        └── auth → permission → plan feature → rate limit → allowance meter
```

---

## Provider and models

| | |
|---|---|
| Provider | Anthropic |
| SDK | `@anthropic-ai/sdk` (official), `maxRetries: 2` |
| Default model | `claude-sonnet-5` — override with `ANTHROPIC_MODEL` |
| Fast model | `claude-haiku-4-5-20251001` — override with `ANTHROPIC_FAST_MODEL` |
| Credential | `ANTHROPIC_API_KEY`, optional |

Both model IDs were checked against the Anthropic model catalogue on
**2026-09-08** and are active — neither deprecated nor retired. Four of the
seven capabilities pass `fast: true` and run on Haiku; three run on the default
model. Nothing is hardcoded: `lib/env.ts` reads both from the environment, so an
operator can move to a different model without a code change.

### Why the client knows about model generations

`lib/ai/client.ts` carries a `MODEL_TRAITS` table, and it exists because request
shape is **not** uniform across Claude generations and the differences are hard
400s rather than quality differences:

- **No sampling parameters, ever.** `temperature`, `top_p` and `top_k` were
  removed from the Sonnet 5 / Opus 4.7+ generation. A non-default value is an
  invalid request, not a hint the model ignores. `GenerateOptions` therefore has
  no `temperature` field at all — the four capabilities that used to set one now
  express that intent in the prompt text, which is where the current guidance
  puts it.
- **Thinking is on by default on some models.** On Sonnet 5, a request that
  omits `thinking` runs with adaptive thinking, and `max_tokens` caps thinking
  *plus* response text together. These calls are deliberately short (350–2,000
  tokens) and five of them force a tool call, so an unbounded think can consume
  the budget and return no `tool_use` block — which surfaces as "no structured
  output" rather than as the truncation it is. The client sends
  `thinking: { type: 'disabled' }` where the model both thinks by default and
  accepts the disable.
- **An unknown model gets the minimal request.** `DEFAULT_TRAITS` assumes
  nothing, producing a four-key request — model, max_tokens, system, messages —
  which is the shape most likely to be valid on a model nobody has
  characterised. Adding a model means adding a row.

`tests/unit/ai-client.test.ts` asserts all of this against a mocked SDK: no
sampling parameter on either model, `thinking` present on Sonnet and absent on
Haiku, and a four-key request for an unrecognised `ANTHROPIC_MODEL`.

---

## Structured output

Every AI result in this product renders into real UI — a prefilled campaign
form, a scored program verdict, a segment definition the compiler has to
execute. Prose would have to be parsed, and a parser that mostly works is how a
generated campaign silently becomes a half-populated draft.

So `generateStructured` forces a single tool call:

```ts
tools: [{ name, description, input_schema: schema }],
tool_choice: { type: 'tool', name },
```

and then hands `toolUse.input` to a Zod validator. Two independent checks: the
JSON Schema constrains what the model may return, and the Zod parse decides
whether what arrived is usable. A validator that throws propagates — it is never
swallowed into a partially-populated object.

Only two capabilities return free text (`generateText`): the customer summary and
the copy rewrite. Both are prose *by nature* — a paragraph a staff member reads,
and a rewritten message — so there is nothing to constrain.

---

## What happens with no API key

The product works without one. AI surfaces say so.

`env.ai.isConfigured` is `Boolean(env.ai.apiKey)` — derived from the credential,
not from a feature flag somebody can set. The route declares
`requires: () => env.ai.isConfigured`, which produces a `503 not_configured`
carrying the label `AI features`.

This is enforced at two levels on purpose:

1. **At the edge**, by `requires`, so the HTTP contract is honest.
2. **In the library**, by `anthropic()` throwing `notConfigured` before any
   request is built, so a future call site that forgets the guard still cannot
   reach the network.

`asAiError()` exists to keep those two honest about each other. The previous
`catch` wrapped everything in `upstreamFailed('Anthropic')`, which turned a
missing credential into a fabricated provider outage: a deployment that had
simply never been given a key reported "Anthropic request failed". An `AppError`
is already a classified error and now passes through untouched; only failures
that came from the provider or the transport get wrapped.

There is no static-content fallback and no cached "example" output. A feature
that cannot run says it cannot run.

---

## Governance: six gates in a fixed order

`app/api/v1/ai/route.ts` is the only AI entry point, which is the point — one
route means one rate limit, one permission check and one place where AI spend is
governed, rather than seven near-identical endpoints that each have to remember
all three.

| Order | Gate | Failure |
|---|---|---|
| 1 | `auth: 'required'` | `401` |
| 2 | `permissions: ['ai:use']` | `403` |
| 3 | `feature: 'ai'` — plan entitlement | `402 upgrade_required` |
| 4 | `requires: env.ai.isConfigured` | `503 not_configured` |
| 5 | `rateLimit: 'ai'` — 30/hour per tenant | `429` |
| 6 | `meterAction(businessId, 'ai_actions', 1, …)` | `402` when the monthly allowance is spent |

The observed HTTP ordering is `401 → 402 → 503`: an unauthenticated caller is
refused before the plan is consulted, and a caller on a plan without AI is
refused before the credential is checked. That order is deliberate — telling an
unauthorised caller which integrations a deployment has configured is an
information leak, and telling a Starter tenant "not configured" when the real
answer is "not on your plan" is a misleading error.

Gate 6 wraps the **handler**, not each capability. One action costs one unit,
counted only after the model has answered, so a provider outage never burns a
merchant's monthly allowance. Metering at the route rather than inside each
capability means a new AI feature is governed by construction.

Monthly allowances come from `lib/billing/plans.ts` (Starter 25, Growth 300,
Pro 1,500) and are the single source of truth.

### The one background job

`generateAiInsights` in `lib/jobs/handlers.ts` runs from the daily cron. It is
gated on the `advanced_analytics` feature and wrapped in the same
`meterAction`, and an exhausted allowance returns
`{ skipped: 'ai_allowance_exhausted' }` rather than throwing. A cron that
silently spent an untracked model call on every tenant every night is exactly
the shape of problem this gating exists to prevent.

---

## What reaches the provider

Stated per feature in [`AI_REALITY_MATRIX.md`](./AI_REALITY_MATRIX.md). The
architecture-level rules:

- **Five of seven send aggregates only** — counts, rates, totals, averages, and
  the names a merchant chose for their own segments, campaigns and rewards.
- **The customer summary** sends one customer's *first* name, their visit and
  spend figures, at most 25 activity rows and at most 5 staff notes. It does not
  send full name, email, phone, date of birth, address or database id.
- **The feedback themes feature** sends up to 150 survey comments verbatim,
  because free text cannot be grouped into themes without being read. There is
  no aggregate version of that feature, and pretending otherwise in a privacy
  policy would be the dishonest option.
- **The segment builder sends no tenant data at all** — just the merchant's own
  sentence. The definition it returns is then compiled and counted by SQL
  against the real database.

`tests/unit/ai-data-flow.test.ts` asserts the column lists at source, because
nothing at runtime distinguishes "sent a date of birth and ignored it" from
correct behaviour — the only place that is visible is the `select()`. The
privacy policy in `lib/legal/documents.ts` is written from these same facts, so
a new column here fails a test and the policy gets updated in the same commit.

---

## Prompt injection

Every prompt input authored outside this codebase is delimited:

```ts
function untrusted(label: string, value: unknown): string {
  return `<untrusted_data source="${label}">
${JSON.stringify(value, null, 2)}
</untrusted_data>`
}
```

Seven labels are wrapped: `business_snapshot`, `customer_record`,
`recent_activity`, `staff_notes`, `survey_comments`, `campaign_brief`,
`audience_request`. The system prompt states that content inside such a block is
evidence and never an instruction.

"Our own merchant typed it" is not a trust argument here: staff notes, segment
names and customer names can all arrive through CSV import, and survey comments
are written by the public. The test asserts the labels rather than the helper —
if somebody replaces the mechanism, the labels have to survive for the system
prompt's instruction to still mean anything — and separately asserts that no
`JSON.stringify` interpolation exists outside a wrapper.

---

## AI output is never application state

Nothing the model returns is written to a merchant's data on its own.

- A generated campaign is returned as an **editable draft**. Creating and
  sending it are separate, separately-permissioned, separately-metered actions.
- A proposed segment is compiled and **counted against the real database** before
  the merchant sees it, so the number on screen is SQL's answer, not the model's.
- A program optimisation is a **verdict and a suggestion**.
- A customer summary is **read**, not stored.

The single exception is the insight feed, which persists to `ai_insights` so it
survives a refresh and can be dismissed. Those rows record the `model` that
produced them and expire after seven days; the daily job supersedes advice older
than three days rather than letting the feed become a graveyard. Nothing else is
ever written to that table — no deterministic score is filed there and labelled
as AI.

---

## What is not AI

Passimo computes a lot that looks like machine learning and is not:

| Feature | Actually |
|---|---|
| RFM segmentation | `passimo_recompute_rfm` — SQL quintiles |
| Churn risk | `passimo_recompute_churn_risk` — SQL, from recency against the customer's own cadence |
| Anomaly detection | `passimo_detect_anomalies` — SQL z-scores |
| Segment matching | `lib/segments/compile.ts` — a deterministic compiler to SQL |
| Best time to send | Aggregated historical open/redeem rates |

These are good features and none of them is presented as AI in the product. The
distinction matters beyond honesty: they are deterministic, auditable,
explainable to a merchant, cost nothing per run and work with no API key. The
`anomalies` output *feeds* the AI insight prompt — arithmetic finding the
outliers, the model deciding what to say about them — which is the division of
labour that makes the feature cheap and its inputs checkable.

---

## Cost and rate shape

- 30 requests/hour per tenant (`lib/rate-limit.ts`), independent of the monthly
  allowance. The allowance governs spend; the rate limit governs bursts.
- `max_tokens` is bounded per capability: 350 for a customer summary, 600 for a
  rewrite, 1,500 default for text, 2,000 for structured output.
- Query caps bound prompt size rather than trusting a tenant to be small: 10
  segments, 5 campaigns, 25 activity rows, 5 notes, 150 comments, 2,000 loyalty
  accounts.
- `maxDuration = 60` on the route.

---

## Adding a capability

1. Write the function in `lib/ai/capabilities.ts`. Wrap every externally-authored
   input in `untrusted()`.
2. Use `generateStructured` with a JSON Schema and a Zod validator unless the
   output genuinely is prose.
3. Add the action to the discriminated union in `app/api/v1/ai/route.ts`. It
   inherits all six gates by doing so — do not add a second route.
4. Bound the query. A prompt whose size scales with a tenant's customer count is
   a cost incident waiting for the first large tenant.
5. Do not add a sampling parameter. If the behaviour needs to change, change the
   prompt.
6. Update [`AI_REALITY_MATRIX.md`](./AI_REALITY_MATRIX.md) and, if the data sent
   changes, the AI section of `lib/legal/documents.ts`.

---

## The honest caveat

No `ANTHROPIC_API_KEY` is configured in this repository or its verification
environment, so **no live model call has ever been executed here**. Everything
above is verified structurally rather than empirically:

- the request shape, against a mocked SDK (`tests/unit/ai-client.test.ts`)
- the data sent, against the source (`tests/unit/ai-data-flow.test.ts`)
- the guard ordering, over HTTP against a running server

What that cannot tell us is in `../AI_AUDIT_REPORT.md` under *Still unverified*.
It is a short list, and it is real.
