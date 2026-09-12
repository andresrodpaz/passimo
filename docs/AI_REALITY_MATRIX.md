# AI reality matrix

What is a language-model call, what is arithmetic, and what data leaves the
deployment. One row per feature, no marketing adjectives.

This exists because "AI" is the easiest word in software to spend without
earning. A z-score is not a prediction, a SQL quintile is not a model, and a
product that blurs those is lying in a way that is very hard for a buyer to
check. So: a feature is listed as **AI** here only if a request reaches
Anthropic. Everything else is listed as what it is, which in several cases is
better — deterministic, explainable to a merchant, free to run, and working with
no API key.

See [`AI_ARCHITECTURE.md`](./AI_ARCHITECTURE.md) for how the machinery works.

---

## Real AI — seven capabilities

All seven live in `lib/ai/capabilities.ts` and are reached through
`POST /api/v1/ai` with an `action`. All seven are gated on the `ai` plan feature,
the `ai:use` permission and a configured `ANTHROPIC_API_KEY`, and all seven cost
one `ai_actions` unit.

| # | Action | Model | Output | What is sent | Bound |
|---|---|---|---|---|---|
| 1 | `campaign` | `claude-sonnet-5` | structured, Zod-validated | Business aggregates + the merchant's own brief | 10 segments, 5 campaigns |
| 2 | `insights` | `claude-sonnet-5` | structured, Zod-validated | Business aggregates + SQL anomaly output | 2,000 tokens |
| 3 | `segment` | `claude-haiku-4-5` | structured, Zod-validated | **Nothing but the merchant's sentence** | 500 chars in |
| 4 | `optimize_program` | `claude-sonnet-5` | structured, Zod-validated | Aggregates + a balance distribution (numbers only) | 2,000 loyalty accounts |
| 5 | `customer_summary` | `claude-haiku-4-5` | prose | One customer: first name, visit/spend figures, activity, staff notes | 25 activity rows, 5 notes, 350 tokens out |
| 6 | `feedback_themes` | `claude-haiku-4-5` | structured, Zod-validated | Survey comments **verbatim** + each score | 150 comments |
| 7 | `rewrite` | `claude-haiku-4-5` | prose | The merchant's own text + their instruction | 5,000 chars in, 600 tokens out |

### Data sent, precisely

**Aggregates** (features 1, 2, 4) means: business name, category, city, locale,
currency; the loyalty program's own configuration; 30-day counts, repeat and
churn rates, revenue totals and averages; the names and cached sizes of the
merchant's top 10 segments; and the name, type, send count and attributed
revenue of their last 5 completed campaigns. No customer row, no email address,
no phone number, no customer identifier.

**Feature 3 sends no tenant data at all.** The merchant types "regulars who
haven't been in for a month"; the model returns a segment *definition*; that
definition is then compiled and counted by SQL against the real database. The
number the merchant sees is SQL's answer, not the model's.

**Feature 5** is the narrow exception. It sends `first_name` (not `name`), visit
count, lifetime spend, average ticket, last visit, created date, RFM segment,
churn risk and VIP flag, plus up to 25 activity rows and up to 5 staff notes. It
does **not** send full name, email, phone, date of birth, address, or the
database id. `name` and `birthday` used to be in that `select` and were being
sent to be ignored; they were removed.

**Feature 6** sends up to 150 comments as customers wrote them. Free text cannot
be grouped into themes without being read, so there is no aggregate version of
this feature. Nothing is attached to a comment — no name, no email, no
identifier — but a comment is whatever the person typed.

### Prompt-injection handling

Every externally-authored input is wrapped in `<untrusted_data source="…">` and
the system prompt states that such a block is evidence, never an instruction.
Seven labels are covered: `business_snapshot`, `customer_record`,
`recent_activity`, `staff_notes`, `survey_comments`, `campaign_brief`,
`audience_request`.

### What each result may do

| Action | Result is |
|---|---|
| `campaign` | An editable draft. Creating and sending are separate, separately-metered actions. |
| `insights` | Persisted to `ai_insights` with the model recorded, expiring in 7 days, dismissible. |
| `segment` | A proposed definition, compiled and counted by SQL before display. Not saved. |
| `optimize_program` | A verdict and a suggestion. Changes nothing. |
| `customer_summary` | Read on screen. Not stored. |
| `feedback_themes` | Read on screen. Not stored. |
| `rewrite` | Returned into the editor the merchant was already using. |

Nothing on this list is applied to a merchant's data without a person choosing
it.

---

## Not AI — and not described as AI

| Feature | What it actually is | Where |
|---|---|---|
| RFM segmentation | SQL quintiles over recency, frequency and monetary value | `passimo_recompute_rfm` |
| Churn risk score | SQL: recency measured against that customer's own visit cadence | `passimo_recompute_churn_risk` |
| Anomaly detection | SQL z-scores against the tenant's own trailing history | `passimo_detect_anomalies` |
| Segment matching | A deterministic compiler from a segment definition to SQL | `lib/segments/compile.ts` |
| Onboarding program suggestions | A static per-trade preset table | `lib/onboarding/presets.ts` |
| Duplicate detection on import | Deterministic email/phone matching | `lib/customers/import.ts` |

Two of these deserve a note on the boundary:

**Anomalies feed the AI insight prompt.** SQL finds the outliers; the model
decides what to say about them. That division is why the feature is cheap and
its inputs are checkable — and it is also why "AI insights" is an accurate
label for feature 2 while "AI anomaly detection" would not be.

**Churn risk is not a prediction and is not sold as one.** The plan copy lists it
under analytics, next to retention cohorts. A Pro tier highlight that read
"Daily AI insights, churn prediction and program optimisation" was corrected: it
attached the word AI to a SQL score, and it advertised as a Pro differentiator
two things Growth already includes.

---

## Verification status

| Claim | How it is checked | Status |
|---|---|---|
| No sampling parameter sent, either model | `tests/unit/ai-client.test.ts` vs mocked SDK | ✅ asserted |
| `thinking` disabled on Sonnet, omitted on Haiku | same | ✅ asserted |
| Unknown model gets a minimal 4-key request | same | ✅ asserted |
| Tool call forced; validator propagates | same | ✅ asserted |
| `not_configured` with no key, provider never called | same | ✅ asserted |
| `stop_reason` surfaced when no tool call returns | same | ✅ asserted |
| No email/phone/address/birthday in any AI `select` | `tests/unit/ai-data-flow.test.ts` vs source | ✅ asserted |
| Every customer-scoped read also filters `business_id` | same | ✅ asserted |
| All 7 untrusted labels present; no bare interpolation | same | ✅ asserted |
| Gate ordering `401 → 402 → 503` | HTTP probes vs running server | ✅ 12/12 |
| Model IDs active, not deprecated | Anthropic model catalogue, 2026-09-08 | ✅ confirmed |
| Model output quality | — | ⚠️ never run |
| Real latency, token cost, provider error bodies | — | ⚠️ never run |
| That Anthropic accepts the exact request we build | — | ⚠️ never run |

The last three are the honest limit of this document. No `ANTHROPIC_API_KEY` is
configured in this repository or its verification environment, so **no live model
call has ever been executed here**. The request shape is asserted against a mock
of the SDK, which proves what we send and cannot prove what Anthropic does with
it.

That gap is exactly how the `temperature` defect survived to be found in this
audit: without a key, every call stopped at `notConfigured` long before it
reached the provider, so the honest credential-absent behaviour the product is
proud of was also what kept a launch-blocking 400 invisible. The first action
after a real key is configured should be one call per capability, on both
models, with the response recorded — see `../AI_AUDIT_REPORT.md`.
