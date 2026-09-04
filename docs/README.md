# Passimo documentation

Every document here describes what the code **actually does**. Where something is
partial, planned or dependent on credentials, it says so in those words.

Honest status of the product as a whole:
[`../FUNCTIONAL_VERIFICATION_REPORT.md`](../FUNCTIONAL_VERIFICATION_REPORT.md) for
what has been *executed and verified*, and
[`../PASSIMO_LAUNCH_STATUS.md`](../PASSIMO_LAUNCH_STATUS.md) for the architecture
and brand-migration narrative behind it.

---

## Start here

| If you want to… | Read |
| --- | --- |
| Run it locally | [`../README.md`](../README.md) |
| Understand how the pieces fit | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Deploy it | [`RAILWAY.md`](RAILWAY.md), then [`INFRASTRUCTURE.md`](INFRASTRUCTURE.md) |
| Fix something that is broken | [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) |
| Know what is not finished | [`../FUNCTIONAL_VERIFICATION_REPORT.md`](../FUNCTIONAL_VERIFICATION_REPORT.md) |
| Log in and try it | [`../DEMO_CREDENTIALS.md`](../DEMO_CREDENTIALS.md), then [`DEMO_TESTING.md`](DEMO_TESTING.md) |
| Check whether the database is healthy | [`DATABASE_VERIFICATION.md`](DATABASE_VERIFICATION.md) |

---

## Infrastructure

| Document | Covers |
| --- | --- |
| [`INFRASTRUCTURE.md`](INFRASTRUCTURE.md) | What runs where; the storage decision; scaling limits; what is deliberately absent |
| [`POSTGRESQL.md`](POSTGRESQL.md) | The database layer, the query builder, migrations, connection pooling, type parsing |
| [`RAILWAY.md`](RAILWAY.md) | First deployment, scheduled jobs, connecting `passimo.app`, rollback |
| [`ENVIRONMENT.md`](ENVIRONMENT.md) | Every variable, what breaks without it, and which are secrets |
| [`OPERATIONS.md`](OPERATIONS.md) | Runbook, integrations, backups |

## Security and identity

| Document | Covers |
| --- | --- |
| [`AUTHENTICATION.md`](AUTHENTICATION.md) | Accounts, password hashing, sessions, recovery, and what is *not* implemented (no MFA, no OAuth) |
| [`SECURITY.md`](SECURITY.md) | Threat model, authorisation, tenant isolation, GDPR posture |

Authorisation lives in two places and is documented where it is enforced: the
role/permission matrix in [`SECURITY.md`](SECURITY.md), and plan-based feature
gating in [`SUBSCRIPTIONS.md`](SUBSCRIPTIONS.md). The distinction matters — `403`
means your role cannot do this, `402` means your plan cannot.

## The product

| Document | Covers |
| --- | --- |
| [`PRODUCT.md`](PRODUCT.md) | What Passimo is, the loop it serves, who each surface is for, and what is honestly unfinished |
| [`ONBOARDING.md`](ONBOARDING.md) | The three-step flow, what was cut and why, the dashboard checklist |
| [`STORE_EXPERIENCE.md`](STORE_EXPERIENCE.md) | The counter scanner, browser support, offline behaviour, the loyalty transaction |
| [`WALLET_PROXIMITY.md`](WALLET_PROXIMITY.md) | Apple and Google passes, geofencing, proximity campaigns, the no-code rule engine, privacy |
| [`BRAND_AND_CARD_DESIGN.md`](BRAND_AND_CARD_DESIGN.md) | **Where the card designer lives and how a merchant finds it**, the Brand Kit, the contrast guarantee, templates, the Apple/Google previews, and what a merchant still cannot set |
| [`SUBSCRIPTIONS.md`](SUBSCRIPTIONS.md) | The plan catalogue ($5 floor, no free tier), feature gates, limits, trial and lapse behaviour |
| [`INTERNATIONALIZATION.md`](INTERNATIONALIZATION.md) | How "never mix languages" is enforced by the type system rather than intended |
| [`API.md`](API.md) | REST reference, authentication, webhooks, error envelope |
| [`DEMO_ENVIRONMENT.md`](DEMO_ENVIRONMENT.md) | `pnpm seed:demo`, the accounts it creates, what each demonstrates |

## Verification

Three documents that exist so a claim about this product can be checked rather
than believed.

| Document | Covers |
| --- | --- |
| [`../DEMO_CREDENTIALS.md`](../DEMO_CREDENTIALS.md) | Sign-in details for every plan, a test script per plan, and the feature matrix as *verified against the running API* |
| [`DEMO_TESTING.md`](DEMO_TESTING.md) | A practical walkthrough: exercise every feature by hand, in the order a merchant meets them |
| [`DATABASE_VERIFICATION.md`](DATABASE_VERIFICATION.md) | The 15-file diagnostic suite (`pnpm db:verify`), what each file answers, and how to reset, seed and inspect |
| [`../FUNCTIONAL_VERIFICATION_REPORT.md`](../FUNCTIONAL_VERIFICATION_REPORT.md) | What was executed, what it returned, what was fixed, and what remains — per area, with completion percentages |

## Engineering

| Document | Covers |
| --- | --- |
| [`TESTING.md`](TESTING.md) | The four suites, what each is for, and the gaps |
| [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) | Symptoms → causes → fixes |

---

## Where the rest of it is documented

Some subjects are best documented next to the code, and this index would rather
point at the real thing than restate it badly:

| Subject | Where |
| --- | --- |
| Loyalty rules engine | `lib/loyalty/rules.ts` — the header explains precedence and stacking; `docs/STORE_EXPERIENCE.md` covers the transaction |
| The loyalty schema and its functions | `db/migrations/000004`, `000006`; `POSTGRESQL.md` §1 |
| CRM, segments, customer search | `lib/segments/definition.ts` (the filter DSL) and `lib/customers/service.ts` |
| Marketing and the consent gate | `lib/messaging/dispatch.ts` — the single place consent, suppression, quiet hours and frequency caps are enforced |
| Automations | `lib/automations/engine.ts` — trigger → wait → re-check → act |
| Analytics | `db/migrations/000007_analytics.sql`; every figure is computed from `activity_events` and `loyalty_ledger` |
| AI | `lib/ai/capabilities.ts` — each capability degrades to a stated "not configured" rather than inventing output |
| Billing resilience | `lib/billing/dunning.ts`, `webhook-idempotency.ts`; `SUBSCRIPTIONS.md` |
| Migration decisions | The header comment of each file in `db/migrations/` — 000017 (the brand rename), 000018 (row-level security), 000019 (scan idempotency), 000020 (enrolment sources) and 000021 (the brand/card-design consolidation) each explain a real bug and its fix |
| The wallet card's own vocabulary | `lib/wallet/pass-content.ts` → `buildPassLabels`, and `wallet.pass.*` in the dictionaries. Both providers render from it so an Apple and a Google card cannot disagree |

---

## Conventions in these documents

- **Status labels.** *Implemented*, *partial*, *planned*, *credential-dependent*.
  Anything unlabelled is implemented.
- **Limitations are listed, not omitted.** A document that only describes what
  works is a document nobody trusts the second time.
- **No invented traction.** No customer counts, no testimonials, no revenue
  figures. Passimo has not launched.
