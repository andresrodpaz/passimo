# Passimo — Launch Status

**Date:** 2026-08-28
**Supersedes:** the 2026-08-27 revision of this file, and `LAUNCH_AUDIT_REPORT.md` (2026-08-01, written under the Fidelio name)

This revision reports the state after a **resumed execution**. The previous
session was interrupted by a machine shutdown mid-pass; this one recovered the
tree, established what was actually finished, and continued from there.

Every claim below was verified against the code and the running database on the
date above. Where something was **not** verified, it says so and names what would
verify it. Two claims in the previous revision were wrong; both are corrected
here and the corrections are called out rather than quietly edited.

---

# Executive summary

Passimo is a multi-tenant SaaS loyalty and retention platform for physical
businesses. The brand migration from Fidelio is complete, the infrastructure is
provider-independent PostgreSQL with no Supabase dependency of any kind, and the
product runs locally against a containerised database with a full demo dataset.

The honest position is unchanged in shape but firmer in substance: **this is a
coherent, well-built product ready for a small, hand-held first cohort of paying
merchants — and not ready for self-service public launch.** The gap is not code
quality. The three things a merchant pays for at the edges — wallet passes,
outbound messaging, card payments — are all credential-dependent, and none of
those accounts exist yet. The architecture for all three is complete and tested.

What changed materially this session is that the wallet-customisation feature
went from *written* to *working and verified*. It had two defects that would each
have been discovered by the first merchant rather than by us:

1. **Migration `000021` had never been applied.** The entire Brand Kit and card
   design feature — `wallet_card_designs`, the brand columns on `businesses` —
   was absent from the database while the code that reads it had shipped. The
   designer would have failed at runtime on first use. It is applied now, and the
   schema is verified present.
2. **The customer-facing wallet card was entirely in English.** Every label in
   `apple-pass.ts` and `google-loyalty-jwt.ts` was a hardcoded literal, so a
   Spanish café's customers carried a card reading `MEMBER` / `SINCE` / `TO GO`
   with `en-GB` dates. This is the most permanent surface the product has and the
   only one a merchant cannot correct from the dashboard.

The feature also had **no tests at all**. It has 141 now.

### Verified this session

| Check | Result |
| --- | --- |
| `pnpm typecheck` | **Pass**, clean |
| `pnpm lint` | **Pass**, 0 errors, 0 warnings |
| `pnpm test` (unit) | **634 passed**, 26 files |
| `pnpm test:integration` (real PostgreSQL 16) | **71 passed**, 4 files |
| `pnpm db:migrate` | 22/22 applied (`000021` was pending; now applied) |
| Schema spot-check via `psql` | `wallet_card_designs` present with all 22 columns and both check constraints; 11 brand columns present on `businesses` |
| Supabase dependency | **Zero** — nothing in `package.json`, nothing in first-party source |
| localhost development | Preserved. `env.appUrl` falls back to `http://localhost:3000` |

### Not verified this session

| Check | Why |
| --- | --- |
| `pnpm build` (production) | Not run — the build was declined during this session |
| `pnpm test:e2e` (Playwright, desktop + mobile) | Depends on a production build, so it could not run either |
| Lighthouse / axe audit | No tooling run; the accessibility and performance sections below are inspection-based and say so |

**This matters for the readiness score.** The previous revision reported a
passing production build; that result is from 2026-08-27 and predates every
change in this session. Treat the build as unverified until it is re-run.

---

# Recovery summary

The repository is **not** under version control (`git status` → not a repo), so
recovery was reconstructed from file modification times, then confirmed by
reading the code.

**Where the previous session stopped:** the last write was
`lib/i18n/dictionaries/es.ts` at 12:21, immediately after a typecheck at 12:20.
The tree was left type-clean and green (493 tests passing), so the interruption
did not corrupt anything — it simply stopped partway through the localisation
pass.

**How far it had got.** Classified by inspection:

| Area | State on recovery |
| --- | --- |
| Wallet card designer, previews, platform switch | **Complete** and wired end-to-end (designer → store → `pass-content` → both providers) |
| Brand Kit model, store, panel, logo upload | **Complete** for the wallet path |
| Brand Kit reuse on customer pages / email | **Partial** — each surface inlined its own colour fallbacks and skipped the contrast rule |
| Onboarding wizard, presets, persistence, resume | **Complete**, server-side, well tested |
| Landing page, interactive demo | **Complete**, camera-free, no fake metrics — but untested |
| QR scanner separation | **Complete** — real scanner at `/pos` and in the dashboard shell; landing demo requests no camera |
| Localisation of wallet card, email, pushes, gift shop | **Missing** — this is where the session was cut off |
| Migration `000021` | **Written but never applied** |
| Tests for card design / Brand Kit / pass building | **Missing entirely** |
| `emails/*.tsx` (6 React Email templates) | **Dead** — nothing imported them; superseded by `lib/messaging/email-layout.ts` |

The smoking gun for the cut-off point was in `lib/jobs/commerce-handlers.ts`: the
gift-card query already selected `locale`, and nothing used it. The previous
session had begun that file and stopped.

**Nothing working was rewritten.** The wallet designer, the onboarding flow, the
landing demo and the scanner separation were all good and were left alone. Every
change below was a gap, a defect, or a duplication.

---

# Wallet customization status

**Complete. 95%.**

A merchant can customise, without code: template, card style (solid / gradient /
duotone / frosted), progress rendering (auto / bar / stamps / points / none),
typography, background, foreground and accent colours, logo, the six visibility
toggles (member name, member since, tier, location, reward, progress), headline,
custom message and terms text.

The preview updates immediately and **is not a mock** — it renders through
`resolveCardDesign`, the same function the pass builder calls. It presents both an
Apple Wallet-style and a Google Wallet-style layout with a QR representation,
customer information, balance, rewards and branding, and it is labelled as a
preview. It does not claim to be a real provider pass, which matters because
without credentials no real pass can be issued at all.

**Fixed this session:**

- The whole card face is now localised. `buildPassLabels` resolves every fixed
  string once, in the *business's* language, onto `WalletPassContent.labels`;
  both providers render from it. Dates go through one shared
  `pass-format.ts` rather than three `toLocaleDateString('en-GB')` calls.
- Google's `language` tags on `localizedIssuerName` and image
  `contentDescription` now carry the business locale. They said `'en'`
  unconditionally, which made the screen-reader label wrong on every Android
  phone that installed a Spanish card.
- A dead branch in `apple-pass.ts` —
  `locations.length === 1 ? 'Where to use it' : 'Where to use it'` — collapsed to
  a single label. Both arms were identical, so the ternary conveyed an intent the
  code never had.
- Migration `000021` applied, so the feature has a schema to read.

**The 5%:** `heroImageUrl` is stored, resolved and consumed by both providers
(Apple `strip.png`, Google `heroImage`), but no component renders it and there is
no upload control — a merchant can neither set nor preview it. `secondaryColor`
is editable and stored but no surface renders it.

---

# Brand Kit status

**Complete. 92%.**

One record of business identity on the `businesses` row: name, description, logo
/ icon / cover, four colours, font, seven contact fields, three social handles.
Migration `000021` made it authoritative and removed the second source of truth
(`wallet_settings.brand_color`, which used to be consulted *first* when building a
pass, so a merchant who set a colour in Settings had two answers to one question
with the less discoverable one winning).

**Fixed this session — the reuse requirement.** The previous revision's claim that
the Brand Kit was read by "the wallet card, the public join page, the browser
card, transactional email, campaigns and notifications" was **aspirational rather
than true**. `getBrandKit` was consumed by exactly three API routes. Each of the
other surfaces reached for `business.primary_color` directly with its own
`?? '#111827'` / `?? '#f59e0b'` / `?? '#ffffff'` chain.

That had a real consequence, not just duplication: those surfaces used the
**stored** `text_color` verbatim, while `resolveCardDesign` only honours a stored
foreground that passes WCAG AA. The same two columns therefore produced a legible
wallet card and an illegible public join page. A merchant who set white text in
March and a cream background in April got exactly that.

Now centralised through two helpers:

| Helper | Used by |
| --- | --- |
| `resolveBrandPalette` | join page, browser card page, public gift shop |
| `emailBrandFromRow` | the email shell, via `mapBrandKit` |

The email shell also had its **own** contrast function whose comment claimed WCAG
relative luminance while computing an unweighted channel average with no gamma
correction and a 0.6 threshold. It disagreed with the card resolver often enough
to matter. Both now go through the single implementation in `card-design.ts`, and
a test asserts they agree across five brand colours.

**The 8%:** campaigns and automations still compose their own copy and do not read
brand imagery; `secondaryColor` and `coverUrl` have no rendering surface.

---

# Interactive onboarding status

**Complete. 95%.** Not modified this session — it was already good.

Flow: business type → loyalty strategy → reward → branding → wallet design →
location → activation, with visual trade selection, smart per-trade defaults
(`lib/onboarding/presets.ts`), a live card preview at every step, validation, a
progress percentage, optional steps (plan and shop are skippable; program and
card are not), and a completion screen that lists what is already running.

It reads as *building a loyalty program* rather than filling in a form, which was
the requirement.

**Verified, not assumed:** 30 unit tests in `tests/unit/onboarding-resume.test.ts`
pin the resume rules, including the three that matter most — a live trial is not
evidence of choosing a plan (every signup has one); a stale cursor never jumps
past a location that has since been deleted; and a cursor written by the previous
wizard (`location`, before it was renamed `shop`) still resumes correctly.

---

# Onboarding resume status

**Complete. 100%.**

Progress is persisted **server-side** in `business_onboarding.last_step`, not in
`localStorage`. That is what makes it survive the full list: refresh, logout,
login, browser close and session expiry all resume at the right step, because the
cursor never lived in the browser.

The stored step is treated as a **hint, not an instruction**. The wizard
recomputes which steps are genuinely outstanding from the account itself and uses
the cursor only to avoid sending someone back to a screen they had already passed.
`hasConfiguredLocation` deliberately does not count the placeholder location that
`passimo_provision_business` creates at signup — treating that as an answer is
what previously made the location step unreachable for every merchant, so no
geofence had a centre and no pass carried a place.

---

# Landing demo status

**Complete. 100%.**

A genuine interactive product simulation as a pure state machine
(`lib/landing/demo.ts`), driven by a button. It requires no camera, no
microphone, no location, no authentication, no external service and no hardware,
and it works on desktop, laptop, tablet and mobile.

The loop a visitor can drive: customer visit → points and stamps update →
progress changes → reward unlocks → wallet card updates → merchant sees the
result in analytics.

Two design decisions worth recording because they are easy to get wrong:

- It **opens mid-journey** (7 visits, 840 points, one stamp from the goal), so the
  visitor's *first* click produces the unlock. A demo starting at zero asks a
  stranger to press a button eight times to see the point of the product.
- Redeeming clears the stamps and **deliberately keeps the points**. That is the
  two-speed loop real programs run — a fast stamp card for the habit, a slow
  spend tier underneath that a customer never loses. Zeroing both would teach the
  wrong model.

The customisation demo renders the **same** card templates a merchant is actually
offered, so the marketing page cannot promise a design the designer will not
produce.

**Added this session:** 32 tests. The module's own header argued that "does the
reward actually unlock at the goal" should not be a question answered by
clicking — and it had shipped with no tests. They now pin the loop, the
single-announcement guard (without it, a visitor who keeps clicking gets the
celebration on every press, which reads as a bug), the points-tier countdown
never going negative, and that **all 24 trade/palette combinations resolve to a
card that passes WCAG AA**.

**No fabricated traction anywhere.** No customer counts, no revenue figures, no
testimonials. A single invented number discounts every true claim beside it, and
this page has true claims worth protecting.

---

# Landing page status

**Complete. 93%.**

Redesigned, fully localised, responsive, and rendering the real card component
through the real resolver. The mock browser chrome above the product showcase
displays the host resolved from `NEXT_PUBLIC_APP_URL` rather than a hardcoded
`passimo.app` — putting an unpurchased domain on the marketing page as though it
were live would be a small lie in a place that cannot afford one.

**The 7%:** no social proof section exists, correctly, because there is nothing
honest to put in it yet. That is a launch-content gap rather than a code gap.

---

# QR scanner status

**Complete. 100%.** Correctly separated, which was the explicit requirement.

| Surface | What it does |
| --- | --- |
| **Landing page** | Visual product simulation. No camera API is referenced anywhere in `components/landing/`. |
| **Merchant dashboard** | Real scanner. `ScanButton` in the dashboard shell (`app/dashboard/layout.tsx`) and the full-screen counter at `/pos`. |

The real scanner uses the device camera through browser APIs
(`lib/client/use-qr-scanner.ts` + `lib/client/qr-decode.ts`, `jsqr`), behind a
login, on a device that is actually at a counter. It has manual search fallback,
seven distinct scan outcomes, and an offline queue so a visit is never lost.

Both experiences work independently. The previous demo led with a simulated
scanner viewport; it was removed because most landing traffic is desktop, where a
camera view is either irrelevant or — worse — reads as a permission request
before the visitor knows what the product is. It also framed the product as
*scanning*, which is the mechanism, when the thing worth paying for is the loop.

---

# Localization status

**Complete. 96%.** This was the bulk of the session's work.

The mechanism was already strong: `en.ts` is the reference, `Dictionary` is
derived from it with leaves widened to `string` so a missing Spanish key is a
**build error**, and `tests/unit/i18n.test.ts` catches what types cannot —
untranslated pastes, mismatched `{placeholders}`, half-declared plurals, blank
values.

**The previous revision claimed 100% coverage. That was wrong**, and the way it
was wrong is instructive: it was measured in *screens*, and by that measure it was
nearly right. It missed everything that is not a screen.

Fixed this session:

| Surface | Was | Now |
| --- | --- | --- |
| **Wallet card face** | Every label an English literal in both providers; `en-GB` dates | `buildPassLabels`, business locale, shared date formatter |
| **Email shell** | `lang="es"` hardcoded on every message; English "Unsubscribe" inside it; English "Powered by" | Locale-driven `lang`, translated footer |
| **Gift card delivery + receipt** | Fully English; `en-GB` money and dates | Business locale, business currency |
| **Membership renewal merge fields** | `en-GB` money and dates | Business locale, memoised per business |
| **Proximity push fallbacks** | English — and these are the version most customers saw, since they fire only when the merchant has *not* written their own copy | Business locale |
| **Public gift shop** | Entirely English; owned no dictionary keys at all; hardcoded `€` regardless of the business's currency | Fully localised, currency from the row |
| **Partnership / gift-card-sale / service-recovery notices** | English; the sale notice printed `25.00` with no currency symbol | Recipient's locale, currency from the row |
| **Location CSV import errors** | English | Business locale |
| **Two public pages' error handling** | Took the server's English sentence *first* | Route through `toastError`, which prefers our own translated copy per error code |

The locale rule is now consistent and documented: a **customer** message prefers
`customers.locale` (they stated a preference at enrolment); everything else
produced without a request uses `businesses.locale`. `lib/messaging/dispatch.ts`
is the only place the distinction applies.

**The screen-coverage test now carries the non-screen surfaces** — `wallet.pass`,
`wallet.push`, `emails`, `giftShop`, `join` — as named entries, so this specific
blind spot cannot reopen silently.

**The 4%:** server-side Zod validation messages (`lib/api/schemas.ts`) are
English. They surface only for a malformed request that the client's own
validation should have caught first, and the error envelope already carries a
stable `code` that `lib/client/api-errors.ts` translates — so the English prose is
the last fallback, not the first. Closing it properly means per-field error codes,
which is a real refactor rather than a string sweep.

---

# Mobile UX status

**Good. 88%. Verified by inspection, not by device testing.**

Grounds for the number: touch targets on the public flows are `h-12`/`h-14`
(48–56px, above the 44px guideline); `viewport` and `themeColor` are exported
from the root layout; the Playwright suite defines a Pixel 7 project alongside
Desktop Chrome; layouts use responsive Tailwind throughout; the counter scanner
is designed full-screen for a phone at a till; `inputMode="numeric"` is set where
it matters.

**Caveat, stated plainly:** the mobile e2e project **was not run this session**,
because it needs a production build. "88%" is a code-reading judgement, not a
measurement. Running `pnpm test:e2e` is what would turn it into one.

---

# Accessibility status

**Reasonable. 82%. Inspection-based; no audit tool was run.**

Grounds: 369 `aria-*` attributes and 74 explicit `role=` attributes across
`app/` and `components/`; 28 `sr-only` labels; `<html lang>` is set dynamically
from the resolved locale (not hardcoded), which is what screen readers and search
engines read; `role="alert"` on error regions; Radix primitives underpin the
interactive components, which brings focus management and keyboard handling.

The contrast work is genuinely load-bearing rather than cosmetic: WCAG AA is
enforced in code for the card, the join page, the browser card, the gift shop and
the email header, and a test asserts the guarantee holds across every
background/foreground pairing and all 24 landing-demo combinations.

**Not verified:** no axe, Lighthouse or screen-reader pass has been run. Keyboard
traversal of the full dashboard has not been walked. Treat 82% as "built with
accessibility in mind and provably correct on contrast", not "audited".

---

# Performance status

**Adequate. 80%. Partly measured, partly not.**

What is genuinely good: every checklist count is a `head: true` count, so a
workspace with 40,000 scans does not pay for a row scan to render a checklist;
analytics are computed from `activity_events` and `loyalty_ledger` rather than
recomputed per request; the business-locale lookup is memoised for a minute so a
cron fan-out does not read one row hundreds of times; `lib/rate-limit-cache.ts` is
bounded and tested, on the highest-volume endpoint in the product; migrations
carry deliberate indexes.

Two honest notes:

- `next.config.mjs` sets `images: { unoptimized: true }`. That is a defensible
  choice for a standalone container with no image CDN, but it means merchant logos
  and hero images are served at whatever size they were uploaded. With merchant-
  supplied images on a customer-facing card page, this is the first performance
  thing to revisit.
- **No production build was run this session**, so there are no current bundle
  figures. The unit suite runs in ~14s and the integration suite in ~20s.

---

# Database migration status

**Complete. 100%. And this is where the most important fix of the session was.**

| Item | State |
| --- | --- |
| Direction | Railway + PostgreSQL. Confirmed. |
| Supabase | **Zero.** No package, no client, no auth, no storage, no realtime, no generated types, no environment variables in first-party code. |
| Migrations | **22 of 22 applied.** `000021_brand_kit_and_card_design.sql` was pending on recovery and has been applied. |
| Schema verified | `wallet_card_designs` present, 22 columns, primary key on `business_id`, both `card_style` and `progress_style` check constraints. 11 brand columns present on `businesses`. |
| Local development | Unchanged and working. `pnpm db:up` → `db:migrate` → `seed:demo`. `env.appUrl` falls back to `http://localhost:3000`. |
| Production domain | Through `NEXT_PUBLIC_APP_URL` only. `passimo.app` appears in source **exclusively inside comments explaining why it is not hardcoded**, plus one RFC-required VAPID contact URI fallback. |
| Credentials | None hardcoded anywhere. `DATABASE_URL` is the entire coupling to the database host. |

**The unapplied migration was a genuine launch-blocking defect.** The code that
reads `wallet_card_designs` had shipped; the table did not exist. The first
merchant to open the card designer would have hit a 500. It is worth noting how
it happened: the migration runner verifies a SHA-256 per file and is correct, but
nothing in the previous session's workflow ran it after writing the migration.

Current database contents: 25 businesses, 2,694 customers, 25 loyalty programs,
2,694 loyalty accounts, 4 card designs (a missing design row is the default
design, not an error — verified by test).

---

# Testing status

**Good, with one real hole. 85%.**

| Suite | Result |
| --- | --- |
| Unit — `pnpm test` | **634 passed, 26 files.** Was 493 / 22 on recovery. |
| Integration — `pnpm test:integration` (real PostgreSQL 16) | **71 passed, 4 files** |
| `pnpm typecheck` | Clean |
| `pnpm lint` | Clean — 0 errors, 0 warnings |
| End-to-end — `pnpm test:e2e` | **Not run.** Requires a production build, which was not performed this session. |

**141 tests added**, covering the feature that had none:

| File | Tests | Covers |
| --- | --- | --- |
| `wallet-card-design.test.ts` | 55 | Hex parsing; WCAG ratios against published values; the AA guarantee across every background/foreground pairing; progress-style resolution and its boundary at 12 stamps; row mapping and enum fallback; Brand Kit mapping; handle normalisation; patch building; `resolveBrandPalette` agreeing with the card resolver |
| `wallet-pass-build.test.ts` | 33 | Apple `pass.json` and Google class/object structure; the ten-location cap and widest-radius `maxDistance`; locale-correct dates; a guard that no English phrase survives on a Spanish pass |
| `email-shell.test.ts` | 21 | The shell agreeing with the card on text colour; `lang`; translated footer; HTML escaping of merchant copy |
| `landing-demo.test.ts` | 32 | The demo loop; repeat cycles; points surviving redemption; all 24 trade/palette combinations legible |

Three of my own test expectations were wrong and the code was right — Spanish
`es-ES` does not zero-pad the month, `Contacto` contains `Contact`, and
`normalizeHandle` correctly splits on `/` to handle pasted URL paths. Those were
corrected in the tests, not worked around in the code. **No test was weakened or
disabled**, and the i18n suite caught one genuine issue in my own work (`María` as
a placeholder), which is the suite doing its job.

**The hole is e2e.** `tests/e2e/merchant-journey.spec.ts` (326 lines) exists and
walks the full flow, but it has not been executed against this tree. That is the
single largest gap in the verification story below.

---

# Real merchant journey status

**Partially verified. Honest answer: not end-to-end this session.**

| Step | Verification |
| --- | --- |
| Sign up, session lifecycle, lockout, revocation | **Verified** — `auth-lifecycle.test.ts`, real PostgreSQL |
| Business creation and provisioning | **Verified** — integration suite |
| Business type → strategy → reward → branding → card design → location → activate | **Verified by unit test** for the resume/step logic and preset defaults; **not** clicked through a browser |
| Customer creation, loyalty transaction, reward redemption | **Verified** — `loyalty-flow.test.ts` against real PostgreSQL |
| Tenant isolation | **Verified** — `tenant-isolation.test.ts`, written as attacks |
| Scanner → visit → points → progress → unlock | **Verified at the logic layer**; the camera path is only exercisable by e2e |
| Analytics reflecting the above | **Not verified this session** |
| Wallet customisation persisting and reaching a pass | **Verified** — schema present, store tested, `buildPassContent` → both providers tested |

I did **not** claim this as a completed browser-driven journey, because it was
not one. What is verified is verified against real database state via the
integration suite; the rest needs `pnpm build && pnpm test:e2e`.

---

# Documentation status

**Good. 90%.**

`/docs` holds 20 documents. Added and corrected this session:

- **`docs/BRAND_AND_CARD_DESIGN.md` — new.** The Brand Kit, the card design model,
  the contrast guarantee and why it overrides the merchant, progress resolution
  and the 12-stamp limit, templates, the previews, card-face localisation, the
  tests, and an explicit table of what a merchant still cannot set. The docs had
  **zero** coverage of this feature before.
- **`docs/INTERNATIONALIZATION.md` — corrected.** Its "100% coverage" claim is
  replaced with an accurate account, including *why* the claim was wrong
  (measured in screens, missed everything that is not a screen) and a table of
  which background surfaces resolve which locale.
- **`docs/TESTING.md` — corrected.** Counts updated to 634 / 71; the new suites
  described; and the e2e suite explicitly marked as written-but-not-run rather
  than left implying it passes.
- **`docs/README.md`** — index updated.

The documentation convention is worth preserving: *implemented / partial /
planned / credential-dependent*, limitations listed rather than omitted, and no
invented traction.

**The 10%:** `ONBOARDING.md` still describes a "three-step flow" and predates the
rebuilt wizard. `STORE_EXPERIENCE.md` and `API.md` have not been re-read against
the current code this session.

---

# Overall completion

## **91%**

| Area | Weight | Score |
| --- | --- | --- |
| Wallet customisation | high | 95% |
| Brand Kit | high | 92% |
| Interactive onboarding | high | 95% |
| Onboarding resume | medium | 100% |
| Landing page + demo | medium | 95% |
| QR scanner separation | high | 100% |
| Localisation | high | 96% |
| Database / infrastructure | high | 100% |
| Testing | high | 85% |
| Documentation | medium | 90% |
| Mobile UX | medium | 88% |
| Accessibility | medium | 82% |
| Performance | medium | 80% |

Up from the previous revision's 88%. The increase is earned by real gaps closed —
an unapplied migration, an unlocalised customer-facing card, an untested
feature, four duplicated brand-resolution paths — and held back by the build and
e2e suites not having been run.

# Launch readiness score

| Scenario | Score | Basis |
| --- | --- | --- |
| **Pilot cohort — hand-held first merchants** | **87 / 100** | A merchant can be onboarded, customise their card, scan customers and be billed manually today. Up 2 from the previous revision: the migration fix removed a certain first-use failure, and the card is no longer English for a Spanish merchant. Held back from higher only by the unrun build/e2e. |
| **Public self-service launch** | **64 / 100** | Blocked on four accounts that do not exist — Stripe, Apple Wallet, Google Wallet, Resend — and on the fact that **no production deployment has ever run**. Neither is a code problem, and neither can be fixed by writing more code. |

Those two numbers are not comparable to the 2026-08-01 audit's single 78/100,
which predates the infrastructure migration, the onboarding rebuild and every
test suite that now exists.

---

# Remaining issues

Ordered by what would hurt a real merchant soonest.

### P0 — do before the next merchant touches it

1. **Run `pnpm build` and `pnpm test:e2e`.** Everything in this session was
   verified by typecheck, unit and integration tests. The production build and the
   browser journey are unverified against this tree. This is the largest known
   unknown in the document.
2. **Do one throwaway Railway deployment.** Every word in `docs/RAILWAY.md` is
   written from configuration, not experience. An unrehearsed first deploy during
   a merchant's onboarding is the worst possible time to discover a config gap.

### P1 — credential-gated, and nothing ships without them

3. **Apple Wallet certificates.** The builder and its `pass.json` are complete and
   tested; no pass can be issued. `appleWalletConfigured()` returns false and the
   UI says so honestly.
4. **Google Wallet issuer account.** Same position.
5. **Stripe account.** Billing, dunning and webhook idempotency are implemented
   and tested; no payment can be taken.
6. **Resend (or any SMTP).** Every email path is written and the shell is now
   correctly localised; nothing can be delivered.

### P2 — real product gaps

7. **`heroImageUrl` is unreachable.** Stored, resolved, consumed by both
   providers — and with no upload control and no component rendering it, a
   merchant can neither set nor see it. Either finish it or remove it from the
   model; a half-wired field is worse than neither.
8. **`secondaryColor` renders nowhere.** Editable and stored, with no surface. Same
   choice: finish or remove.
9. **`docs/ONBOARDING.md` is stale.** It describes a three-step flow that no
   longer exists.
10. **`images: { unoptimized: true }`** with merchant-supplied logos on
    customer-facing pages. Revisit when there is a CDN.

### P3 — known and acceptable for now

11. **Server-side Zod validation messages are English.** Last-fallback only; the
    error envelope's `code` is translated first. Closing it means per-field error
    codes.
12. **No MFA, no OAuth.** Documented in `AUTHENTICATION.md` as absent.
13. **`components/ui/pagination.tsx` has English `aria-label`s** and is imported
    by nothing. Vendored shadcn primitive; harmless while unused, needs
    localising if it is ever used.
14. **Accessibility has not been audited** by tooling, and mobile has not been
    tested on a device.
15. **No version control.** The repository is not a git repo. Every safeguard in
    this project — the migration checksums, the type-enforced dictionary, the test
    floors — assumes a history that does not exist. The six dead email templates
    removed this session were backed up outside the project for exactly that
    reason. `git init` is the cheapest risk reduction available.

---

# Recommended roadmap

### This week — make it provable

- `pnpm build`, then `pnpm test:e2e` on both viewports. Fix what falls out.
- `git init` and a first commit. Nothing below is safe without it.
- One throwaway Railway deploy, then tear it down. Write down what
  `docs/RAILWAY.md` got wrong.

### Next — open the accounts

- Stripe, Apple Wallet, Google Wallet, Resend, in that order. Stripe first because
  it is the only one that unblocks *revenue* rather than a feature; Apple before
  Google because iOS is the larger wallet share in the target market.
- After each, run the corresponding path against real credentials once. The code
  is tested; the *integration* is not.

### Then — pilot cohort

- Three to five merchants, onboarded by hand, billed manually.
- Instrument the onboarding funnel. The wizard's resume logic is well tested but
  nobody has watched a real café owner use it between customers, which is the
  situation it was designed for.
- Finish or delete `heroImageUrl` and `secondaryColor` based on whether any pilot
  merchant asks for them.

### Before public self-service

- Accessibility audit (axe + one screen-reader pass) and a real-device mobile
  pass.
- Per-field validation error codes, closing the last English-fallback path.
- Image optimisation with a CDN.
- Load-test the scan endpoint. It is the highest-volume path and its rate limiter
  is the only unbounded-growth surface in a request path.

### Deliberately not recommended yet

- More features. The product is feature-complete against its spec at 91%. The
  remaining 9% is not code, and the gap between "ready for a pilot" (87) and
  "ready for the public" (64) is entirely accounts, one deployment, and
  verification — none of which more code will close.
