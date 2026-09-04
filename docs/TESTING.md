# Testing

Four suites, each with a job. The division is deliberate: the fast one must stay
runnable with nothing installed, and the slow ones must test things a mock
cannot.

```bash
pnpm verify           # typecheck + lint + unit          — no database
pnpm verify:full      # the above + integration           — needs PostgreSQL
pnpm test             # unit only
pnpm test:coverage    # unit, with thresholds
pnpm test:integration # real PostgreSQL
pnpm test:e2e         # Playwright, both viewports
```

Current state, all four run against this tree on 2026-09-04:

| Suite | Result |
| --- | --- |
| Unit — `pnpm test` | **667 passed, 27 files** |
| Integration — `pnpm test:integration` | **82 passed, 5 files** |
| End-to-end — `pnpm test:e2e` | **179 passed, 1 skipped**, both viewports, against a production build and a live database |
| `pnpm typecheck`, `pnpm lint` | Clean |

The single skip is `wallet-card-designer.spec.ts`'s mobile-only assertion under
the desktop projection, which is the correct outcome rather than a gap.

---

## 1. Unit — `tests/unit/`, `vitest.config.ts`

Pure logic. No database, no network, no browser. 27 files.

The rule that keeps it useful: **it must run with nothing but Node.** A unit suite
that needs a database running is a unit suite people stop running, and then stop
writing. Everything that genuinely needs one lives in `tests/integration/`.

Coverage thresholds (80% lines/functions/statements, 70% branches) apply to a
named list of modules rather than the project average, because a project average
can be satisfied by a pile of trivial UI tests. The list is the code where a bug
costs money or is invisible in production:

- `lib/loyalty/rules.ts` — decides how much value a customer receives
- `lib/wallet/geo.ts`, `eligibility.ts`, `rules.ts` — decides whether a real
  person's phone buzzes. Both failure modes are invisible: an over-eager rule
  costs the merchant the wallet pass permanently (a deleted card cannot be
  re-permissioned), an over-strict one silently sends nothing and reads as "the
  feature is broken"
- `lib/billing/plans.ts`, `dunning.ts`, `webhook-idempotency.ts` — decides what
  a merchant may do and what we are paid for it
- `lib/i18n/translate.ts` — the mechanism that stops a page rendering half in
  English
- `lib/scan/payload.ts` — every check-in starts by classifying a scanned string;
  getting it wrong serves the wrong customer or spends the wrong gift card
- `lib/auth/password.ts` (via `auth-password.test.ts`) — decides whether a leaked
  table is a catastrophe or an inconvenience
- `lib/crypto.ts`, `lib/rate-limit-cache.ts`, `lib/onboarding/*`, `lib/segments/*`

`tests/stubs/server-only.ts` neutralises the `server-only` marker, since these
deliberately import server modules directly.

### The card and brand suites

Four files cover what a merchant actually customises and what a customer
actually receives. They were added because the whole wallet-customisation
feature had shipped with **no tests at all**, and its failure modes are the worst
kind: the artefact is a pass installed on a phone, so an unreadable colour pair
is not something a merchant reports and we hotfix out of their customers'
wallets.

| File | What it pins |
| --- | --- |
| `wallet-card-design.test.ts` | Hex parsing; WCAG contrast against the published ratios; the AA guarantee across every background/foreground pairing; progress-style resolution and its boundary at 12 stamps; row mapping and enum fallback; Brand Kit mapping and handle normalisation; `resolveBrandPalette` agreeing with the card resolver |
| `wallet-pass-build.test.ts` | Apple `pass.json` and Google class/object structure; the ten-location cap and `maxDistance`; locale-correct dates; and a guard asserting no English phrase survives on a Spanish pass |
| `email-shell.test.ts` | The email shell agreeing with the card on text colour; `lang`; translated footer; HTML escaping of merchant-authored copy |
| `landing-demo.test.ts` | The demo state machine — that the reward really unlocks at the goal, that the loop repeats, that points survive redemption — and that all 24 trade/palette combinations resolve to a legible card |

The pass builders are exported separately from their signing and network steps
precisely so these can exist: the repository ships without Apple or Google
credentials, so asserting on the emitted structure is the only way that code path
is verifiable at all.

---

## 2. Integration — `tests/integration/`, `vitest.integration.config.ts`

Real PostgreSQL, no mocks.

```bash
pnpm db:up && pnpm db:migrate && pnpm test:integration
```

Every assertion here is about something the *database* decides, which is exactly
what a mock cannot tell you:

| File | What it pins |
| --- | --- |
| `query-builder.test.ts` | The emitted SQL parses; casts land; `ON CONFLICT` resolves to the index the caller meant — including partial ones, which is a bug class that only appears against a real server; the unfiltered-write guard actually refuses |
| `auth-lifecycle.test.ts` | Registration, case-insensitive email, lockout, suspension, session revocation, expiry, single-use tokens, cascade on delete |
| `tenant-isolation.test.ts` | Written as attacks: two real tenants and every attempt by one to reach the other |
| `loyalty-flow.test.ts` | Scan → earn → ledger → rollups → reward → redemption → analytics, asserted against rows rather than responses |

Each file creates its own tenants with unique slugs and drops them afterwards.
Nothing reads or writes the demo data: a test that depends on `pnpm seed:demo`
having run fails on a colleague's machine for no reason, and one that mutates it
makes the next `pnpm dev` confusing. Files run serially, because the isolation
tests assert on counts.

The teardown also exercises the schema's `on delete cascade` rules — a missing
cascade shows up here as a foreign-key error rather than as an orphaned row
nobody notices for a year.

### Why tenant isolation lives here

Migration 000018 removed the row-level security policies (see
`docs/POSTGRESQL.md` §3). These tests are what stands in their place, so they are
written as an adversary would: read another tenant's customer by id, search for
their email, update their row, credit their customer, read their analytics. All
must fail.

---

## 3. End-to-end — `tests/e2e/`, `playwright.config.ts`

Two viewports, because the counter is used on a phone at a till and the review
screens on a desktop, and the two have different failure modes.

| File | Scope |
| --- | --- |
| `public.spec.ts` | Landing, auth screens, security headers, error envelope, accessibility basics |
| `onboarding.spec.ts` | Signup → three steps → the counter, through the UI |
| `merchant-journey.spec.ts` | The same journey through the API, twelve steps deep, asserting state |
| `counter.spec.ts` | PWA manifest, service worker, offline page, camera permissions policy |
| `commerce.spec.ts` | Pricing page, gift card shop, billing degradation without Stripe |
| `wallet-card-designer.spec.ts` | Can a merchant *find* the card designer? Sidebar, dashboard callout and checklist each in one click; both wallet previews present and labelled as previews; template applied → saved → reloaded → still there; no horizontal overflow on a phone; the Spanish render with no English left behind |
| `demo-plans.spec.ts` | The public pricing tiers and the demo environment's plan states |

Most of the suite runs **unseeded and unauthenticated**, deliberately: it asserts
what is true of *any* deployment rather than of a fixture. The tests that need a
merchant create one through the public signup endpoint and skip with a stated
reason when there is no database. A suite that quietly asserts nothing is worse
than one that says it could not.

### Three things worth knowing before adding tests here

**Auth is rate limited** to 8 requests per five minutes per IP, counting signups
*and* sign-ins together. That is a security control, not a test inconvenience.

Two consequences, both learned the hard way:

- Specs that need a merchant run serially and share one, rather than creating one
  per test — `onboarding.spec.ts` does this.
- Sharing the merchant is not enough on its own. `wallet-card-designer.spec.ts`
  originally signed in per test with one shared account, which still spent eight
  auth requests; it passed alone and failed inside the full suite, reporting a
  product bug that was not there. It now authenticates once in `beforeAll` and
  replays the session cookies into each test's context. **Prefer that pattern for
  any new spec that needs a session.**

**The suite should run against `pnpm dev` too.** That means selectors have to
tolerate Next.js's injected dev-tools button — hence `{ name: 'Next', exact: true }`
rather than a loose match.

```bash
pnpm test:e2e                                     # builds and starts the app
E2E_BASE_URL=http://localhost:3000 pnpm test:e2e  # reuse a running dev server
```

### `merchant-journey.spec.ts` is the important one

It is the test the product requirements call for: signup → plan → loyalty
configuration → reward → location → activate → customer enrols from the QR →
scan → visit recorded → reward awarded → analytics agree.

Deliberately API-level. A twelve-step UI script fails for reasons unrelated to
the product — a reworded label, an animation — while the failure mode it protects
against is one step writing a row the next step does not read, or an endpoint
returning `{ ok: true }` for something that did not happen. It also asserts a
replayed scan does *not* count twice, which is the property the offline queue's
safety argument rests on.

---

## 4. CI

Four jobs, in `.github/workflows/ci.yml`:

| Job | Proves |
| --- | --- |
| `verify` | Typecheck, lint, unit tests with coverage thresholds — no database |
| `build` | A production build succeeds with **no** secret and **no** database configured. This is why nothing in `lib/env.ts` is read at module scope |
| `database` | Migrations apply to an empty PostgreSQL; a second run is a no-op; the seed runs; the integration suite passes; `db:reset` rebuilds from scratch |
| `e2e` | Playwright on both viewports against a real build and a real database |

The `database` job is the one that changed most. Its predecessor had to create a
fake `auth` schema before the migrations would apply, which meant CI was never
proving what a restore would actually do. It now applies the real thing to an
empty database — the claim being tested is that a fresh PostgreSQL initialises
from this repository alone.

The idempotence step matters more than it looks: a retried deploy re-runs the
migration command, so "the second run finds nothing to do" is a property
production depends on.

---

## 5. Gaps

Stated rather than implied:

- **No component tests.** React rendering is covered only through Playwright, so
  a broken prop on a rarely-visited screen can reach a deploy.
- **No visual regression tests.** Layout changes are caught by eye. The
  horizontal-scroll assertion in `commerce.spec.ts` is the one exception, and it
  exists because it caught a real bug.
- **Wallet passes are not verified against a device.** Pass *generation* is
  tested; whether Apple accepts the signature can only be confirmed with real
  credentials on a real phone.
- **No load testing.** The N+1 and index work is reasoned about, not measured.
- **Email and SMS delivery are mocked at the provider boundary.** Whether Resend
  accepts the payload is not covered.
- **Accessibility coverage is shallow** — landmarks, labels, keyboard operation
  of the login form. No axe run, no screen-reader pass.
