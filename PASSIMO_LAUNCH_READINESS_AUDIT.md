# Passimo — launch readiness audit

**Date:** 2026-09-10
**Type:** recovery and continuation of an audit interrupted by machine shutdown
**Scope:** what survived the interruption, what it was doing, whether it is correct, and what the product's launch position actually is.

---

## 1. Recovery status

### When the interruption happened

The shutdown is datable to the second from filesystem timestamps:

| Time (2026-09-09) | File | What it means |
|---|---|---|
| 16:34:34 | `scripts/clean-test-data.ts` | new tooling written |
| 16:34:43 | `package.json` | `db:clean-test-data` script registered |
| 16:51:04 | `lib/legal/documents.ts` | legal prose being corrected |
| 16:51:18 | `tsconfig.tsbuildinfo` | a typecheck ran against that edit |
| **16:51:36** | `tests/unit/legal-accuracy.test.ts` | **last write before the machine died** |

The interrupted run was **mid-way through a legal-accuracy pass**: correcting the privacy policy against the code it describes, and writing the test that pins the correction. It got as far as writing both files. Nothing after that.

### What was found on disk

Present and complete:

- `AI_AUDIT_REPORT.md` (Sep 8, 16:17)
- `docs/AI_ARCHITECTURE.md` (Sep 8, 16:15)
- `docs/AI_REALITY_MATRIX.md` (Sep 8, 16:16)
- `PRICING_AUDIT.md`, `PASSIMO_MERCHANT_ACCEPTANCE_REPORT.md`
- Legal routes (`app/legal/[document]/page.tsx`), legal content, legal translations
- 12 untracked new test files, 2 untracked migrations, team/tags/customers features

**Absent:** `PASSIMO_LAUNCH_READINESS_AUDIT.md` — the top-level report was never written. This document is it.

### Environment damage from the shutdown

| Thing | State on recovery | Action |
|---|---|---|
| Docker Desktop | daemon down | restarted (non-destructive) |
| Postgres container | **still running**, data intact | reused; nothing reset |
| Migrations | **26 applied, 0 pending** | none re-run |
| Working tree | 109 modified/untracked, no conflicts | preserved |

**No migration was interrupted.** The newest (`000025_merchant_terms_consent`) applied Sep 8 15:54 — a full day before the shutdown. Nothing was half-applied, and nothing needed repair. No destructive command was run against the database at any point in this audit.

---

## 2. Classification of prior work

### Completed and verified

Everything below was found on disk *and* re-verified in this session by running it.

| Area | Evidence |
|---|---|
| Legal content correction | `tests/unit/legal-accuracy.test.ts` passes; corrected prose renders live on `/legal/privacy` |
| Legal routes | `/legal/terms`, `/legal/privacy`, `/legal/cookies` all HTTP 200 live; invalid doc 404s |
| The 8 AI findings | all re-verified against current source (§4) |
| AI model configuration | verified against current Anthropic model catalogue (§4.1) |
| Entitlements & metering | 126 integration tests pass against real rows |
| Database integrity | `db-verify`: 235 pass, 0 fail, "Data integrity holds" |

### Completed but not previously verified — now verified

The `legal-accuracy.test.ts` file was written at 16:51:36 and the machine died before anything ran it. **It passes.** The interrupted edit was complete and correct, not half-finished. This was the single most important thing to establish, because a half-written test file is the most likely casualty of a shutdown at that exact moment.

### Not started

- `PASSIMO_LAUNCH_READINESS_AUDIT.md` (this document)
- Concurrency coverage for AI metering (added in this session — §5)

### Unknown / not verifiable here

- Any live Anthropic API behaviour — no credential exists in this environment (§4.3)
- Stripe, Apple/Google Wallet, email/SMS/WhatsApp live behaviour — all credential-dependent

---

## 3. Test and verification results

Every command below was run in this session against the recovered environment.

| Command | Result |
|---|---|
| `pnpm typecheck` | **clean** |
| `pnpm lint` | **clean** |
| `pnpm test` (unit) | **723 passed / 33 files, 0 failed** |
| `pnpm test:integration` | **126 passed / 9 files, 0 failed** |
| `pnpm db:verify` | **235 pass, 28 warnings, 0 fail, 0 error** — "Data integrity holds. orphans=0 duplicates=0 impossible=0" |
| `pnpm db:migrate --status` | 26 total, **0 pending** |
| `pnpm verify:functional` | **841 passed, 0 warnings, 0 failed** (live, against the running app) |
| `pnpm test:e2e` (Playwright) | **157 passed, 61 skipped, 0 failed** — desktop + mobile viewports |
| Live route probes | legal ×3 → 200; bad legal doc → 404; unknown page → 404; AI unauth → 401 |

The 61 skipped e2e tests all guard on the same condition — `demo account … is not
present — run pnpm seed:demo`. **I did not run the seed.** The brief for this
recovery explicitly forbids destroying existing demo data, and I could not
establish that `seed:demo` is non-destructive against the demo tenants already
in this database (Madrid Coffee, Sevilla Bakery and others carry real history
that `db-verify` reports on). Re-running the demo-plan suite against a
disposable database is outstanding work, not a passed check.

What the 157 that *did* run cover is still substantial and directly relevant to
launch: security headers on every response, anonymous rejection of protected
endpoints, the documented error envelope, request-id presence, forged card-token
rejection, cron endpoints refusing callers without the shared secret, sign-in
not revealing whether an account exists, and — on the mobile viewport —
keyboard-operable labelled forms, exactly one `main` landmark per page, and no
horizontal scroll.

The 28 `db:verify` warnings are informational, and two are worth naming:

- `rls_enabled=0, rls_disabled=58` — **deliberate.** Migration `000018` removed RLS on purpose; isolation is application-layer. This is exactly what the corrected privacy policy now says, and `legal-accuracy.test.ts` fails if the policy ever re-claims RLS.
- `pending_over_an_hour=9503` — dev-environment artifact: no job worker runs locally. **Must be re-checked in production**, where a backlog of that size would be a real incident.

---

## 4. AI audit — continued and verified

The prior `AI_AUDIT_REPORT.md` claimed 8 findings, all fixed. I treated that as a claim to test, not a result to accept. **All 8 verify against current source.**

### 4.1 Model configuration — checked against the live model catalogue

| Setting | Value | Lifecycle status |
|---|---|---|
| Default model (`ANTHROPIC_MODEL`) | **`claude-sonnet-5`** | **Active** |
| Fast model (`ANTHROPIC_FAST_MODEL`) | **`claude-haiku-4-5-20251001`** | **Active** |

Neither is deprecated or retired. Both request shapes are valid for their model:

- **Sonnet 5 rejects non-default `temperature`/`top_p`/`top_k` with a 400.** The prior audit's finding AI-1 — that every request used to send `temperature` — was a genuine launch blocker, correctly diagnosed. `temperature` is now absent from `GenerateOptions` entirely.
- **Sonnet 5 thinks by default when `thinking` is omitted**, and `max_tokens` caps thinking plus response text together. With calls bounded at 350–2,000 tokens and five of seven forcing a tool call, `thinking: { type: 'disabled' }` is correct and is what the code sends.
- **Haiku 4.5 does not think unless given `budget_tokens`**, and predates the disable shape — so omitting the field, which is what the code does, is correct. Sending one shape to both models would be a 400 on one of them.
- The `claude-opus-5` row is also correct: disabling thinking is legal only at effort ≤ `high`, and the code sends no `effort`, so the default (`high`) keeps it legal.

`MODEL_TRAITS` in `lib/ai/client.ts` is accurate. An unrecognised model falls back to a minimal four-key request, which is the right conservative default.

### 4.2 The seven capabilities

All reached through one endpoint, `POST /api/v1/ai`, discriminated by `action`.

| # | Action | Model | Output | Business data sent | Customer PII |
|---|---|---|---|---|---|
| 1 | `campaign` | `claude-sonnet-5` | structured + Zod | aggregates + merchant's brief | none |
| 2 | `insights` | `claude-sonnet-5` | structured + Zod | aggregates + SQL anomalies | none |
| 3 | `segment` | `claude-haiku-4-5` | structured + Zod | **nothing but the merchant's sentence** | none |
| 4 | `optimize_program` | `claude-sonnet-5` | structured + Zod | aggregates + balance distribution | none |
| 5 | `customer_summary` | `claude-haiku-4-5` | prose | one customer's figures + activity + staff notes | **first name only** |
| 6 | `feedback_themes` | `claude-haiku-4-5` | structured + Zod | up to 150 survey comments **verbatim** | **free text, as written** |
| 7 | `rewrite` | `claude-haiku-4-5` | prose | merchant's own text | none |

Verified in source: `buildBusinessSnapshot` selects only `name, category, city, locale, currency` from `businesses`, program configuration, RPC aggregates, and segment/campaign names and counts. **No customer row, no email, no phone, no customer id.**

### 4.3 The question that matters

> If I create a real Passimo merchant account today, add real customers and transactions, and click an AI feature — does Passimo call a real model with real data and return a validated result?

**Today, in this repository and any deployment resembling it: no — and it says so honestly.**

`.env` contains `ANTHROPIC_API_KEY=` with an **empty value**. Verified live against the running application, for a plan entitled to AI:

```
PASS  pro MAY use ai.generate (ai)
      → HTTP 503 not_configured
      → "AI features is not configured on this deployment"
```

Same for Starter and Growth. No fabricated output, no silent fallback to static content, no fake model call anywhere in the codebase. **This is the correct behaviour** — an honest `not_configured` is the right answer to a missing credential.

**With a valid key configured**, per-feature: all seven would issue real Anthropic Messages API calls via `@anthropic-ai/sdk` v0.115.0; five of seven force a tool call and Zod-validate the result; three run on Sonnet 5 and four on Haiku 4.5; real business data is sent as described above. That path has **never been executed** — see §7.

### 4.4 Real AI vs rule-based

Not conflated anywhere. The distinction is maintained honestly in both code and docs:

- **Real AI** (model inference): the seven capabilities above.
- **Rule-based** (deterministic SQL/arithmetic, *not* AI): RFM segmentation, churn-risk scoring, customer counts, revenue and retention figures, segment compilation and counting.
- **Hybrid**: `insights` and `optimize_program` — SQL computes the numbers, the model interprets them. The numbers on screen are the database's answer, not the model's.

Notably, the `segment` feature has the model produce a *definition*, which SQL then compiles and counts — so the count a merchant sees is never a model's guess.

### 4.5 Tenant isolation

Verified in source. Every customer-scoped read in `lib/ai/capabilities.ts` carries a `business_id` filter alongside `customer_id`:

```
line 582: .eq('customer_id', customerId)  →  line 594: .eq('business_id', businessId)
line 600: .eq('customer_id', customerId)  →  line 601: .eq('business_id', businessId)
```

This matters because `summarizeCustomer` fires three queries concurrently — the tenant check on the customer row could not protect the other two, which had already run. Prior finding AI-6 was real and is fixed. `tests/unit/ai-data-flow.test.ts` asserts the pairing at source, so a fourth concurrent query cannot silently reintroduce it.

Route-level: `businessIdFrom: { source: 'body', key: 'businessId' }` resolves the tenant through the membership check in `defineRoute`, so a forged `businessId` in the body fails authorisation rather than reaching a query. Live-verified: a cross-tenant roster read returns **403**.

### 4.6 Prompt injection

Genuinely well handled, and better than most:

- All seven externally-authored inputs pass through `untrusted(label, value)`, which wraps them in `<untrusted_data source="…">`.
- The tag name is fixed and the label is code-supplied, so **nothing user-controlled can forge a closing tag** to escape the block.
- The system prompt explicitly states such a block is evidence and never an instruction. Both halves are load-bearing — the tag is inert without the instruction, and the instruction is unenforceable without the tag.

This matters more than it might appear: staff notes, customer names and segment names can all arrive via **CSV import**, and survey comments are written by the public.

### 4.7 Metering — and the one gap I found

Plan allowances are correct: **Free 0 · Starter 25 · Growth 300 · Pro 1,500** (`lib/billing/plans.ts`).

`meterAction` runs `check → act → count`, so a provider outage never burns a merchant's allowance. Integration tests cover below-limit, at-limit, over-limit, provider-failure-not-charged, and exactly-once. All pass.

**The gap: `meterAction` is a check-then-act with no lock across the provider call.** The code acknowledges this ("the check-then-act window is acceptable because the cost of briefly exceeding a soft quota is zero"). That reasoning is right for `customers` or `locations` — a merchant with 501 customers on a 500 plan costs nothing. **It does not transfer to `ai_actions`, where every unit of overshoot is a billable inference call.**

Nothing tested this, so I measured it (`tests/integration/ai-metering-concurrency.test.ts`, added this session):

```
[ai meter] burst=8 remaining=3 sold=7 used=29/25 overshoot=4
```

With three units left, a burst of eight concurrent requests **sold seven and overshot the cap by four**. The meter never under-counts — everything sold is charged — but the cap is not a hard ceiling under concurrency. Production exposure is bounded by the route's own rate limit (`ai`: 30/hour), so worst case is a one-off overshoot per period, not an ongoing leak; the third test confirms that once the counter is durably past the cap, a concurrent burst is refused in full with **zero** inference calls made.

**A second, related finding:** `trackUsage` swallows RPC failures — it logs a warning and returns. If `passimo_track_usage` fails, the AI call already happened but is never counted. This is fail-open on a cost-bearing meter. It is defensible (don't fail a user's successful action because metering broke) but it should be a deliberate decision rather than an incidental one, and it is currently invisible in production except as a log line.

I have **not** changed either behaviour — both are product decisions about fail-open vs fail-closed, and changing metering semantics unilaterally during a recovery audit would be the wrong call. Both are documented here with recommendations in §8.

### 4.8 Failure behaviour

| Condition | Behaviour | Verified |
|---|---|---|
| No credential | `503 not_configured`, honest message | **live** |
| Unauthenticated | `401`, clean JSON, no stack trace | **live** |
| Over plan limit | `402` before any provider call | integration test |
| Provider error | wrapped as `502 upstream_failed`; `AppError` passes through untouched | unit test |
| No tool call returned | error names the `stop_reason`, distinguishing truncation from refusal | unit test |
| Malformed output | Zod validator throws rather than yielding a half-populated object | unit test |

No API key, prompt, or stack trace is exposed in any error path. `not_configured` is rethrown before the error log, so a missing credential does not page anyone.

---

## 5. Work completed in this session

1. **Recovered the environment** — restarted Docker; confirmed Postgres and all 26 migrations intact; ran nothing destructive.
2. **Verified the interrupted legal work** — the test written at the moment of shutdown passes; the corrected prose renders live in both locales.
3. **Independently verified all 8 prior AI findings** against current source rather than accepting the report.
4. **Verified both model IDs and every request-shape decision** against the current Anthropic model catalogue.
5. **Found, measured and documented the AI metering concurrency gap** — added `tests/integration/ai-metering-concurrency.test.ts` (3 tests, passing).
6. **Ran the full verification surface** — typecheck, lint, unit, integration, db:verify, verify:functional, live route probes.
7. **Wrote this report.**

---

## 6. Findings

| # | Area | Finding | Severity | Status |
|---|---|---|---|---|
| 1 | AI metering | Concurrent burst overshoots the AI cap by up to (burst − remaining); measured at 4 extra billable calls | **Medium** | Documented + test added; not changed |
| 2 | AI metering | `trackUsage` swallows RPC errors — a successful AI call can go uncounted | **Medium** | Documented; not changed |
| 3 | Operations | 9,503 jobs pending over an hour in the dev database | **Needs production check** | Dev artifact (no worker); unverified in prod |
| 3b | Testing | 61 e2e tests skipped — demo accounts absent; seed not run to avoid destroying existing demo data | Low | Open — run against a disposable database |
| 4 | AI integration | No live provider call has ever been executed | **High (blocking for AI claims)** | Open — see §7 |
| 5 | Legal | Privacy policy previously denied an offline cache that exists and promised RLS the DB lacks | High | **Fixed and verified** (prior run + this one) |
| 6 | AI | `temperature` sent to a model that rejects it — would have 400'd 3 of 7 capabilities | Critical | **Fixed and verified** |
| 7 | AI | Full name and date of birth sent to the provider unused | High | **Fixed and verified** |
| 8 | AI | Two cross-tenant reads in the customer-summary path | High | **Fixed and verified** |

### Area status

- **Legal** — Terms, Privacy, Cookies all live (200), both locales, content asserted against implementation, no invented company identity/NIF/address/DPO/certifications. Cookie policy discloses exactly the three cookies the code sets (`passimo_session`, `passimo_locale`, `passimo_impersonation`), verified bidirectionally.
- **Security** — tenant isolation enforced in the application layer (RLS deliberately removed in `000018`); cross-tenant reads return 403 live; invitation tokens single-use; owner role non-reassignable and non-removable.
- **Stripe / Wallet / Messaging** — implemented and gated behind `isConfigured`; **all credential-dependent and unverified live** in this environment.
- **Localization** — Spanish default, English available, section/bullet/paragraph parity between locales asserted by test. A dedicated e2e case asserts the wallet-card screen is fully in the merchant's language "with nothing left over" (skipped here — demo account).
- **Accessibility** — covered at a baseline only: login form keyboard-operable and labelled, exactly one `main` landmark per page, no horizontal scroll at mobile width. All passing. This is a smoke level, **not** a WCAG audit — no contrast checking, no screen-reader pass, no focus-order review across the dashboard. Treat as "no obvious breakage", not "accessible".
- **Mobile** — the full e2e suite runs on a Pixel 7 viewport alongside desktop; all non-skipped mobile cases pass.
- **Database** — integrity holds; 0 orphans, 0 duplicates, 0 impossible states; 26/26 migrations applied.

---

## 7. The gap that governs the AI verdict

**No `ANTHROPIC_API_KEY` has ever been configured in this repository or its verification environment. No live model call has ever been executed.**

Every AI claim in this audit — and in the prior one — is verified *structurally*: request shape against a mocked SDK, data flow against the source, guard ordering over live HTTP, model compatibility against the published catalogue. That is real verification and it caught a genuine launch blocker. It cannot answer:

1. Whether Anthropic accepts the exact request now built (this is precisely the class of defect AI-1 was — a mock cannot reject an invalid request).
2. Whether output quality is useful for any of the seven prompts.
3. Real token cost per capability — the 25/300/1,500 allowances were set from *estimated* prompt sizes.
4. Real latency against `maxDuration = 60`.
5. Whether the Zod validators accept real model output, or reject it in a way a merchant sees as a failure.

The architecture is ready. **The integration is untested against the provider**, and until one call per capability has been made and recorded, "AI is production-ready" is not a claim this repository can support.

---

## 8. Recommendations

**Before enabling AI for any real merchant:**

1. Configure a key and make one call per capability on both models; record request, response and token counts. This closes gaps 1, 2 and 5 above at once.
2. Re-check the 25/300/1,500 allowances against *measured* token usage rather than estimates.
3. Time the three Sonnet capabilities against the 60-second limit.
4. Deliberately force a 429 and a schema mismatch; confirm the merchant sees a comprehensible message.

**Metering hardening (findings 1 and 2):**

5. Make the AI meter atomic — reserve the unit before the provider call and release it on failure, or move the check-and-increment into `passimo_track_usage` as a single conditional statement. If the overshoot is instead accepted, say so explicitly in the code and delete the "cost is zero" rationale, which is untrue for this metric.
6. Decide fail-open vs fail-closed for `trackUsage` deliberately, and alert on the warning it currently only logs.

**Operations:**

7. Check the job-queue backlog in production before launch.

---

## 9. AI REALITY CHECK

```
Provider:            Anthropic
SDK:                 @anthropic-ai/sdk v0.115.0
API:                 Messages API (messages.create), non-streaming
Authentication:      ANTHROPIC_API_KEY (environment; currently EMPTY)

Models:              claude-sonnet-5              (default)  — ACTIVE
                     claude-haiku-4-5-20251001    (fast)     — ACTIVE
Model status:        both active; neither deprecated nor retired
Request shape:       verified compatible with both models

Real AI features:    campaign, insights, segment, optimize_program,
                     customer_summary, feedback_themes, rewrite   (7)

Rule-based features (NOT AI):
                     RFM segmentation, churn-risk scoring, customer counts,
                     revenue/retention analytics, segment compilation & counting

Hybrid features:     insights, optimize_program
                     (SQL computes the numbers, the model interprets them)

Mock / fake AI:      NONE — no hardcoded responses, no fabricated model names,
                     no silent fallback to static content anywhere

Customer data sent:  business aggregates, program config, segment and campaign
                     names/counts; for customer_summary, one customer's first
                     name + loyalty figures + activity + staff notes; for
                     feedback_themes, survey comments verbatim
Customer PII sent:   YES, narrowly — first name (1 of 7 features) and free-text
                     survey comments (1 of 7). No email, phone, full name,
                     birthday, address, or customer id, in any feature.

Structured output:   forced tool call + Zod validation on 5 of 7
AI usage metering:   1 unit per action, counted only after a successful result
Starter:             25
Growth:              300
Pro:                 1500
Metering caveat:     not atomic — a concurrent burst can overshoot
                     (measured: +4 on a 25 cap)

Caching:             none (correct — customer data is dynamic)
Observability:       model, tool name and error logged; no PII, no prompts,
                     no API keys logged
Tenant isolation:    enforced; every customer-scoped AI read filters business_id

Missing credential:  HTTP 503 not_configured — verified live, honest, no fake output

Overall AI verdict:  The architecture is real, narrow and better-governed than
                     most. It is also entirely unexercised against the provider.
                     Ready in design; unproven in fact.
```

---

## 10. Launch verdict

### Can Passimo be launched today for a controlled pilot?

**Yes, with AI switched off or explicitly labelled unavailable.**

The core loyalty product is in good shape and the evidence is unusually strong: 841 live functional checks pass end to end, a new merchant can sign up, create a program, configure rewards and branding, register a customer, award a stamp and see analytics — all verified against a running application, not inferred from source. Tenant isolation, entitlements, seat caps, invitation security and database integrity all hold under test. Legal pages exist, are honest, and are asserted against the code they describe.

For a pilot with hand-held merchants and configured credentials, that is a defensible position.

### Can Passimo be exposed as an unattended self-service SaaS today?

**No.**

Three things block it. AI is the headline feature and has never made a single real provider call — the first live request is also the first test of the integration, which is not a thing to discover in front of a paying merchant. Stripe, Wallet and messaging are all credential-dependent and unverified end to end here. And the AI meter is not a hard ceiling under concurrency, which is a cost-control gap that only matters when nobody is watching — which is precisely what unattended means.

### Launch readiness score

**7 / 10.**

Not inflated, and the split matters more than the number:

- **Core loyalty product: 9/10** — verified live, well-tested, honest about its limits.
- **Legal and privacy: 9/10** — genuinely unusual; the policy is tested against the implementation, which almost nothing does.
- **AI: 4/10** — excellent architecture, real governance, zero live proof.
- **Payments / wallet / messaging: unscored** — credential-dependent, unverifiable in this environment.

The single highest-value action available is also the cheapest: configure one API key and make seven calls. That one step would move the AI score more than any amount of further code review, and it is the only thing standing between "the architecture is ready" and "the feature works."
