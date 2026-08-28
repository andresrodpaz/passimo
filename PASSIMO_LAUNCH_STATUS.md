# Passimo — Launch Status

**Date:** 2026-08-28 (final recovery & completion pass)
**Supersedes:** the earlier 2026-08-28 revision, the 2026-08-27 revision, and `LAUNCH_AUDIT_REPORT.md` (2026-08-01, written under the Fidelio name)

This is the state after the final pass of a resumed execution. The original
session was interrupted by a machine shutdown; two subsequent passes recovered
the tree, finished the interrupted work, and then audited it again.

Every figure below was produced by a command run against this tree on this date.
Where something was **not** verified, it says so and names what would verify it.
Three claims in earlier revisions were wrong; all three are corrected here and the
corrections are called out rather than quietly edited.

---

# Executive summary

Passimo is a multi-tenant SaaS loyalty and retention platform for physical
businesses. The brand migration from Fidelio is complete, the infrastructure is
provider-independent PostgreSQL with no Supabase dependency of any kind, and the
schema now provably rebuilds from empty through the migration system.

**The position: ready for a hand-held pilot cohort of paying merchants; not ready
for self-service public launch.** The gap is not code. The three things a merchant
pays for at the edges — wallet passes, outbound messaging, card payments — are all
credential-dependent, and none of those accounts exist. The architecture for all
three is complete and tested.

This pass found and fixed four defects that were each invisible by construction —
they produced no error, no log line and no failing test:

1. **Migration `000021` had never been applied** (found in the previous pass, and
   now proven reproducible: an empty schema replays all 22 migrations cleanly).
2. **A third copy of the contrast formula** lived in `components/loyalty-card.tsx`
   — the component rendered on the join page, the customer card page *and* the
   branding editor. Three copies, each claiming WCAG in a comment while computing
   an ungamma'd channel average, meant one brand colour produced white text on the
   installed pass and dark text on the join page advertising it.
3. **The upload limit was four times the embed limit.** `MAX_LOGO_BYTES` was 2 MB
   while `apple-pass.ts` silently discarded anything over 512 KB. A merchant could
   upload a 1.5 MB logo, see it accepted, see it on their Brand screen and their
   join page — and have it absent from every wallet pass, which is the one surface
   they uploaded it for. Silent, because a dropped image is not an error.
4. **Two brand fields did nothing.** `heroImageUrl` was consumed by both wallet
   providers but had no upload control and no renderer. `secondaryColor` was
   offered in the Brand panel beside three colours that all rendered. Both are now
   implemented rather than documented as gaps.

### Verified this session

| Check | Result |
| --- | --- |
| `pnpm typecheck` | **Pass**, clean |
| `pnpm lint` | **Pass**, 0 errors, 0 warnings |
| `pnpm test` (unit) | **647 passed**, 26 files |
| `pnpm test:integration` (real PostgreSQL 16) | **71 passed**, 4 files |
| `pnpm db:reset` — drop schema, replay from empty | **22/22 migrations applied cleanly** |
| Fresh-schema spot check via `psql` | `wallet_card_designs`: 22 columns, 16 check constraints, PK on `business_id`. 11 brand columns on `businesses`. 22 rows in `schema_migrations`. |
| `pnpm seed:demo` on the rebuilt database | 4 merchants (140–1,240 customers each) + platform admin |
| Integration suite re-run against the rebuilt database | **71 passed** |
| Supabase dependency | **Zero** — nothing in `package.json`, nothing in first-party source |
| localhost development | Preserved. `env.appUrl` falls back to `http://localhost:3000` |

### Not verified this session

| Check | Why it matters |
| --- | --- |
| `pnpm build` (production) | Not run — declined during this session. **The single largest unknown in this document.** |
| `pnpm test:e2e` (Playwright, desktop + mobile) | Depends on a production build, so it could not run either |
| Lighthouse / axe audit | No tooling run. The accessibility and performance sections are inspection-based and say so. |

**Correction to an earlier revision:** the 2026-08-27 status reported a passing
production build. That result predates every change in the last two passes and
should not be read as current.

---

# Brand migration status

**Complete. 100%.**

A repository-wide search for `Fidelio`/`fidelio`/`FIDELIO` outside
`node_modules`, `.next` and build artifacts returns matches in exactly five
categories, every one of them deliberate and commented:

| Where | Why it stays |
| --- | --- |
| `db/migrations/000001`–`000017` | An applied ledger. The runner verifies a SHA-256 per file and refuses to run when one changes — editing them, even in a comment, breaks `db:migrate` on every deployed database. Migration `000017` renames every `fidelio_*` routine to `passimo_*` and asserts zero remain. |
| `lib/scan/payload.ts` | `fidelio:` / `fid:` QR schemes still parse. A printed card in a customer's wallet is not reissued because a company changed its name. `passimo:` / `psm:` are what is generated. |
| `lib/webhooks/deliver.ts` | `X-Fidelio-*` headers sent alongside `X-Passimo-*` for integrators built against the old contract. |
| `app/api/v1/integrations/[provider]/webhook/route.ts` | `x-fidelio-secret` still accepted. The header name is configured in somebody else's system — a Zapier action, a till — and a rename we ship cannot reach into their configuration. Both carry the same secret, so this widens no trust boundary. |
| `lib/customers/placeholder-email.ts` | Recognises the legacy `fidelio.invalid` domain so pre-rename rows are still classified as placeholders. |

Everything user-facing says Passimo: app name, metadata, Open Graph, titles,
emails, auth, onboarding, dashboard, wallet, QR pages, error and empty states,
README, `.env.example`, seed data, package name. Demo accounts are `@demo.com` /
`admin@passimo.demo`.

`passimo.app` appears in first-party source in **five places, all of them
comments explaining why it is not hardcoded**, plus one RFC-required VAPID contact
URI fallback. Development stays on localhost; the production domain arrives
through `NEXT_PUBLIC_APP_URL`.

---

# Wallet customization status

**Complete. 98%.**

Without code, a merchant can set: template, card style (solid / gradient /
duotone / frosted), progress rendering (auto / bar / stamps / points / none),
typography, background, foreground and accent colours, logo, **banner image**, the
six visibility toggles, headline, custom message and terms text.

The preview updates immediately and **is not a mock** — it renders through
`resolveCardDesign`, the function the pass builder calls. It shows an Apple
Wallet-style and a Google Wallet-style layout with a QR representation, customer
information, balance, rewards and branding. It is labelled a preview and does not
claim to be a real provider pass, which matters because without credentials no
real pass can be issued at all.

**Completed this pass:**

- **The banner (hero/strip) image is now reachable.** Upload at
  `POST /api/v1/brand/logo?kind=hero`, rendered by `HeroStrip` in both platform
  framings, consumed by Apple as `strip.png` and Google as `heroImage`. One route
  serves both images, so the hero upload inherits the logo route's auth,
  `settings:write` permission, `upload` rate limit and tenant-scoped storage key
  rather than re-deriving them.
- **The upload and embed ceilings are one number.** `MAX_PASS_IMAGE_BYTES`
  (512 KB) is shared by the route, the client pre-check and the pass builder, so a
  file that cannot reach the card is refused at the file picker in the merchant's
  language instead of never.
- **`secondaryColor` drives something.** It is the far stop of a `gradient` card.
  Text must clear AA against **both** stops, because with a gradient the copy
  crosses two colours and checking only the background is how a card ends up
  readable at the top and invisible at the bottom.

**Fixed in the previous pass:** the whole card face is localised, and a dead
ternary in `apple-pass.ts` (`locations.length === 1 ? 'Where to use it' : 'Where
to use it'`) collapsed to one label.

**The 2%:** `coverUrl` is stored and editable but renders nowhere — the one
remaining half-wired brand field. Per-location card variants are not implemented
(the primary key on `wallet_card_designs` is `business_id`), which is a deliberate
scope choice rather than an omission.

---

# Brand Kit status

**Complete. 97%.**

One record of business identity on the `businesses` row: name, description, logo /
icon / cover, four colours, font, seven contact fields, three social handles.
Migration `000021` made it authoritative and removed the second source of truth
(`wallet_settings.brand_color`, previously consulted *first* when building a pass,
so a merchant who set a colour in Settings had two answers to one question with
the less discoverable one winning).

**Correction to an earlier revision:** the 2026-08-27 status claimed the Brand Kit
was already read by "the wallet card, the public join page, the browser card,
transactional email, campaigns and notifications". That was aspirational.
`getBrandKit` had three consumers; every other surface reached for
`business.primary_color` with its own fallback chain — and used the *stored*
`text_color` verbatim while the card resolver only honours a foreground that
passes AA. The same two columns produced a legible wallet card and an illegible
join page.

Now genuinely centralised:

| Consumer | Path |
| --- | --- |
| Wallet pass (both providers) | `mapBrandKit` → `resolveCardDesign` |
| Public join page | `resolveBrandPalette` |
| Browser card page | `resolveBrandPalette` |
| Public gift shop | `resolveBrandPalette` |
| Outbound email shell | `emailBrandFromRow` → `mapBrandKit` |
| `LoyaltyCard` component | `meetsContrastAA` + `readableTextOn` (shared) |
| Google class fallback | `DEFAULT_BRAND.primaryColor` |
| Onboarding "has this been customised?" | `DEFAULT_BRAND` |

**Luminance is now implemented exactly once**, and that is enforced structurally:
a test reads the source tree and asserts the WCAG coefficients appear in
`card-design.ts` and nowhere else. No unit test on any single copy could have
caught three copies disagreeing; only the count can.

**The 3%:** campaigns and automations compose their own copy and do not read brand
imagery. `coverUrl` has no rendering surface.

---

# Interactive onboarding status

**Complete. 95%.** Not modified in this pass — it was already good.

Four wizard steps defined in one place (`STEPS` in `app/onboarding/page.tsx`) so
the stepper, skip control, progress percentage and resume logic cannot disagree:

| Step | Required | Asks for |
| --- | --- | --- |
| `program` | **Yes** | Stamps or points, and what earns a reward |
| `plan` | No | A plan, or "start my trial" |
| `shop` | No | Shop name, address, city |
| `card` | **Yes** | Palette, reward wording, goal — with a live preview |

Only two screens can actually stop a merchant. Six required interactions, down
from eleven, and the flow now covers *plan* and *location*, neither of which the
original touched.

The `card` step renders the **real** designer — same `CardPreview`, same
`resolveCardDesign` — seeded from the trade's preset. A merchant confirms rather
than composes, and what they see is what their customer installs.

## Onboarding resume — 100%

Progress is persisted **server-side** in `business_onboarding.last_step`. Because
the cursor is not in `localStorage`, it survives refresh, logout, a new login,
closing the browser and session expiry — the whole list is satisfied by *where the
cursor lives* rather than by handling each case.

It is a hint, not an instruction: `resumeStep` recomputes what is genuinely
outstanding from the account. Three rules earn their tests — a live trial is not
evidence of choosing a plan (every signup has one); a stale cursor never jumps a
prerequisite that has since been deleted; a cursor written by the previous wizard
(`location`, before the rename to `shop`) still resumes correctly.
`hasConfiguredLocation` deliberately ignores the placeholder location
`passimo_provision_business` creates at signup — treating that as an answer is
what previously made the location step unreachable for every merchant.

Pinned by 30 tests.

---

# Landing demo status

**Complete. 100%.**

A genuine interactive simulation as a pure state machine (`lib/landing/demo.ts`),
driven by a button. It requires no camera, no microphone, no location, no
authentication, no external service and no hardware, and works on desktop,
laptop, tablet and mobile.

The loop: customer visit → points and stamps update → progress changes → reward
unlocks → wallet card updates → merchant sees it in analytics.

Two decisions worth recording:

- It **opens mid-journey** (7 visits, 840 points, one stamp from the goal) so the
  visitor's *first* click produces the unlock. A demo starting at zero asks a
  stranger to press a button eight times to see the point of the product.
- Redeeming clears the stamps and **keeps the points**. That is the two-speed loop
  real programs run — a fast stamp card for the habit, a slow spend tier
  underneath that a customer never loses.

The customisation demo renders the **same** card templates a merchant is offered,
so the marketing page cannot promise a design the designer will not produce.

32 tests pin the loop, the single-announcement guard (without it a visitor who
keeps clicking gets the celebration every press, which reads as a bug), the
points countdown never going negative, and that **all 24 trade/palette
combinations resolve to a card passing WCAG AA**.

**No fabricated traction anywhere** — no customer counts, no revenue figures, no
testimonials. Verified by search, not asserted.

---

# Landing page status

**Complete. 93%.**

Redesigned, fully localised, responsive, rendering the real card component
through the real resolver. The mock browser chrome above the product showcase
shows the host resolved from `NEXT_PUBLIC_APP_URL` rather than a hardcoded
`passimo.app` — an unpurchased domain presented as live is a small lie in a place
that cannot afford one.

**The 7%:** no social proof section, correctly, because there is nothing honest to
put in it. A launch-content gap, not a code gap.

---

# QR scanner status

**Complete. 100%.** Correctly separated, which was the explicit requirement.

| Surface | Behaviour |
| --- | --- |
| **Landing page** | Visual simulation. No camera API referenced anywhere in `components/landing/`. |
| **Merchant dashboard** | Real scanner — `ScanButton` in the dashboard shell, full-screen counter at `/pos`. |

The real scanner uses the device camera through browser APIs
(`lib/client/use-qr-scanner.ts` + `qr-decode.ts`, `jsqr`), behind a login, on a
device actually at a counter. Manual search fallback, seven distinct scan
outcomes, and an offline queue so a visit is never lost.

The previous demo led with a simulated scanner viewport. It was removed because
most landing traffic is desktop, where a camera view is either irrelevant or reads
as a permission request before the visitor knows what the product is — and because
it framed the product as *scanning*, which is the mechanism, when the thing worth
paying for is the loop.

---

# Localization status

**Complete. 96%.**

The mechanism is strong: `en.ts` is the reference, `Dictionary` derives from it
with leaves widened to `string` so a missing Spanish key is a **build error**, and
`tests/unit/i18n.test.ts` catches what types cannot — untranslated pastes,
mismatched `{placeholders}`, half-declared plurals, blank values.

**Correction to an earlier revision:** the 2026-08-27 status claimed 100%
coverage. It was measured in *screens*, and by that measure it was nearly right.
It missed everything that is not a screen: the wallet card face, the email shell
(`lang="es"` hardcoded on every message ever sent, with an English "Unsubscribe"
inside it), proximity push fallbacks, gift-card emails, and the public gift shop —
a real screen that owned no dictionary keys at all and so contributed nothing for
a dictionary walk to notice.

All fixed. The locale rule is now consistent: a **customer** message prefers
`customers.locale` (they stated a preference at enrolment); everything produced
without a request uses `businesses.locale`. `lib/messaging/dispatch.ts` is the
only place the distinction applies.

The screen-coverage test now carries the non-screen surfaces — `wallet.pass`,
`wallet.push`, `emails`, `giftShop`, `join` — as named entries, so this blind spot
cannot reopen silently.

Background `Intl` calls no longer carry `'en-GB'` literals: gift-card emails had
English month names in front of Spanish customers, and the gift-card-sold
notification printed `25.00` with no currency symbol at all.

**The 4%:** server-side Zod validation messages are English. They surface only for
a malformed request the client's own validation should have caught, and the error
envelope's stable `code` is translated first by `lib/client/api-errors.ts` — so
the English prose is the last fallback, not the first. Closing it properly means
per-field error codes, a real refactor rather than a string sweep.

---

# Mobile UX status

**Good. 88%. Inspection-based.**

Grounds: touch targets on public flows are `h-12`/`h-14` (48–56 px, above the
44 px guideline); `viewport` and `themeColor` exported from the root layout;
`inputMode="numeric"` where it matters; responsive Tailwind throughout; the
counter scanner designed full-screen for a phone at a till; a Pixel 7 Playwright
project defined alongside Desktop Chrome.

**Caveat:** the mobile e2e project **was not run**, because it needs a production
build. 88% is a code-reading judgement, not a measurement.

---

# Accessibility status

**Reasonable. 82%. Inspection-based; no audit tool run.**

Grounds: 369 `aria-*` attributes and 74 explicit `role=` attributes across `app/`
and `components/`; 28 `sr-only` labels; `<html lang>` set dynamically from the
resolved locale; `role="alert"` on error regions; Radix primitives underpinning
the interactive components, which brings focus management and keyboard handling.

The contrast work is load-bearing rather than cosmetic, and it is the part that is
genuinely *proven*: WCAG AA is enforced in code for the card, the join page, the
browser card, the gift shop, the `LoyaltyCard` component and the email header, and
tests assert the guarantee holds across every background/foreground pairing, all
24 landing-demo combinations, and both stops of a gradient.

**Not verified:** no axe, Lighthouse or screen-reader pass. Keyboard traversal of
the full dashboard has not been walked. 82% means "built with accessibility in
mind and provably correct on contrast", not "audited".

---

# Performance status

**Adequate. 80%.**

Genuinely good: every checklist count is a `head: true` count, so a workspace with
40,000 scans does not pay for a row scan to render a checklist; analytics are
computed from `activity_events` and `loyalty_ledger`; the business-locale lookup is
memoised for a minute so a cron fan-out does not read one row hundreds of times;
`lib/rate-limit-cache.ts` is bounded and tested on the highest-volume endpoint;
migrations carry deliberate indexes.

Two honest notes:

- `next.config.mjs` sets `images: { unoptimized: true }`. Defensible for a
  standalone container with no image CDN, but merchant logos and banners are
  served at upload size. With merchant-supplied images now on three
  customer-facing surfaces, this is the first performance item to revisit — the
  512 KB ceiling limits the damage.
- **No production build was run**, so there are no current bundle figures. Unit
  suite ~10–17 s, integration ~11 s.

The membership-renewal sweep resolves one locale per *distinct* business rather
than per membership; on a daily cron over ≤2,000 rows that is a handful of
memoised reads.

---

# Database status

**Complete. 100%. This is where the most important verification of the session happened.**

| Item | State |
| --- | --- |
| Direction | Railway + PostgreSQL. Confirmed. |
| Supabase | **Zero.** No package, no client, no auth, no storage, no realtime, no generated types, no env vars in first-party code. |
| Migrations | **22 of 22.** |
| **Reproducible from empty** | **Yes — verified.** `pnpm db:reset` dropped and recreated the schema and replayed all 22 migrations cleanly, including `000021`. |
| Post-reset schema | `wallet_card_designs`: 22 columns, 16 check constraints, PK on `business_id`. 11 brand columns on `businesses`. `schema_migrations`: 22 rows. |
| Seed on fresh schema | `pnpm seed:demo` succeeded — 4 merchants, 140–1,240 customers each, platform admin. |
| Integration tests on fresh schema | **71 passed.** |
| Local development | `pnpm db:up` → `db:migrate` → `seed:demo`. Working. |
| Credentials | None hardcoded. `DATABASE_URL` is the entire coupling to the database host. |

The previous pass applied `000021` manually after finding it pending. That was
necessary but not sufficient: applying a migration by hand proves nothing about a
fresh deployment. Replaying from an empty schema is the criterion, and it now
passes — which is what makes the first Railway deploy a rehearsal rather than an
experiment.

---

# Subscription status

**Complete. 95%.**

| Requirement | State |
| --- | --- |
| No free plan | **Confirmed.** `PLAN_IDS` is `lapsed, starter, growth, pro, business`. `lapsed` is a paused state, never a working tier. |
| $5/month floor | **Confirmed.** `starter.monthlyPrice = 5`. |
| Tiers | starter $5, growth $19, pro $49, business $99; annual = ten months. |
| Feature gates | `requireFeature` / `requireWithinLimit`, returning `402` with structured `details` distinct from `403` (role). |
| Trial and lapse | 14 days fully unlocked, no card. On lapse the workspace goes read-only — nothing is deleted. |
| Legacy rows | `free` and `enterprise` map to `lapsed`. |
| Paywall copy | Rebuilt from `details` in the browser, so the merchant reads the same numbers the server enforced, in their language. |

Plan taglines and bullets are translation **keys**, not prose, with a unit test
asserting they are keys — the pricing page previously advertised in English on the
Spanish site. Tier *names* stay literal ("Growth" is what appears on the invoice).

**The 5%:** credential-dependent — see Billing.

---

# Billing status

**Implemented, unexercised. 75%.**

Everything is written and tested; nothing has ever taken a payment.

| Piece | State |
| --- | --- |
| Checkout, portal, plan changes | Implemented |
| Webhook handling | Implemented, with **idempotency** — a replayed Stripe event is applied once, not twice or never |
| Dunning | Four-stage ladder with localised email at each stage; a declined card ends in a warned merchant, not a silently paused workspace |
| Soft limits | Overage warns and keeps enrolling — nobody is turned away mid-service |
| Tests | `billing.test.ts`, `billing-dunning.test.ts`, plus `webhook-idempotency` in the coverage floor |

**Blocked on:** a Stripe account. No key, no price IDs, no webhook secret. The
failure paths carry the same coverage floor as the money logic precisely because
they are invisible when they misbehave — they just go quiet.

---

# Security status

**Good. 88%.**

| Area | State |
| --- | --- |
| Authentication | Own users, Argon2-class hashing, sessions, reset, verification. Verified by `auth-lifecycle.test.ts` against real PostgreSQL — lockout, suspension, revocation, expiry, single-use tokens, cascade on delete. |
| Authorization | Role/permission matrix enforced in `defineRoute`; `403` (role) distinct from `402` (plan). |
| Tenant isolation | `tenant-isolation.test.ts` is **written as attacks** — two real tenants and every attempt by one to reach the other. Plus row-level security realigned in migration `000018`. |
| Input validation | Zod at every route boundary; colours normalised rather than trusted before reaching a style attribute. |
| Secrets | None hardcoded. `lib/env.ts` is the only reader; a missing variable is a `503` naming the variable, never its value. |
| Webhooks | Stripe signature verification; shared-secret comparison via `safeEqual` (constant-time). |
| Uploads | Magic-number sniffing — the declared `Content-Type` is a hint, never a decision. **SVG deliberately rejected** (it is a document, it can carry `<script>`, and serving merchant markup inline from our own origin is stored XSS with extra steps). Content-hashed, tenant-scoped keys. Declared length checked before buffering. |
| Rate limiting | Per-route classes including a dedicated `upload` class; the cache is bounded and tested. |
| GDPR | Export excludes push tokens and wallet secrets; delivered by time-limited signed URL, never a public object. Deletion anonymises rather than orphans. |

The hero-image upload added this pass introduced **no new attack surface**: it
reuses the audited logo route, so it inherits the same auth, permission, rate
limit, sniffing and tenant-scoped key. That was the reason for one route rather
than two.

**The 12%:** no MFA, no OAuth (documented as absent in `AUTHENTICATION.md`); the
`s3` storage driver is untested against a real bucket; no penetration test has
been performed.

---

# Testing status

**Good, with one real hole. 86%.**

| Suite | Result |
| --- | --- |
| Unit — `pnpm test` | **647 passed, 26 files** |
| Integration — `pnpm test:integration` (real PostgreSQL 16) | **71 passed, 4 files** |
| Integration re-run on a freshly rebuilt schema | **71 passed** |
| `pnpm typecheck` | Clean |
| `pnpm lint` | Clean — 0 errors, 0 warnings |
| End-to-end — `pnpm test:e2e` | **Not run.** Needs a production build. |

**154 tests added across the two passes** (493 → 647), covering a feature that had
none:

| File | Tests | Covers |
| --- | --- | --- |
| `wallet-card-design.test.ts` | 66 | Hex parsing; WCAG ratios against published values; the AA guarantee across every pairing; the gradient two-stop rule and its documented irreconcilable fallback; progress-style resolution and its 12-stamp boundary; row mapping and enum fallback; Brand Kit mapping; handle normalisation; patch building; **luminance implemented exactly once** |
| `wallet-pass-build.test.ts` | 35 | Apple `pass.json` and Google class/object structure; the ten-location cap and widest-radius `maxDistance`; locale-correct dates; **upload ceiling equals embed ceiling**; a guard that no English phrase survives on a Spanish pass |
| `email-shell.test.ts` | 21 | The shell agreeing with the card on text colour; `lang`; translated footer; HTML escaping of merchant copy |
| `landing-demo.test.ts` | 32 | The demo loop; repeat cycles; points surviving redemption; all 24 trade/palette combinations legible |

Two of those are **structural** rather than behavioural, and both exist because
the bug they guard is a *duplicate*, which no test of any single function can see.
Counting the copies is the only thing that catches it.

Four of my own test expectations were wrong and the code was right — `es-ES` does
not zero-pad months; `Contacto` contains `Contact`; `normalizeHandle` correctly
splits on `/`; and a near-black-to-cream gradient genuinely has no single legible
text colour. All four were corrected in the tests, not worked around in the code.
**No test was weakened, disabled or skipped.** The i18n suite caught one genuine
issue in my own work (`María` used as a placeholder), which is the suite doing its
job.

**The hole is e2e.** `tests/e2e/merchant-journey.spec.ts` (326 lines) walks the
full flow and has not been executed against this tree.

## Merchant journey — verified where it can be, honestly labelled where it cannot

| Step | Verification |
| --- | --- |
| Signup, session lifecycle, lockout, revocation | **Verified** — real PostgreSQL |
| Business creation and provisioning | **Verified** — integration suite, on a schema rebuilt from empty |
| Program → plan → shop → card → activate | **Verified by unit test** for resume logic and presets; not clicked through a browser |
| Brand Kit configuration, wallet customization, preview | **Verified** — schema present, store and resolver tested, both providers tested |
| Customer creation, loyalty transaction, reward redemption | **Verified** — real PostgreSQL |
| Subscription gating | **Verified** — unit tests on plans, gates and limits |
| Tenant isolation | **Verified** — attack-shaped integration tests |
| Scanner → visit → points → unlock | **Verified at the logic layer**; the camera path needs e2e |
| Analytics reflecting the above | **Not verified this session** |

---

# Documentation status

**Good. 92%.** 20 documents in `/docs`.

Added and corrected across these passes:

- **`docs/BRAND_AND_CARD_DESIGN.md` — new, then extended.** The Brand Kit, the card
  design model, the contrast guarantee and why it overrides the merchant, progress
  resolution and the 12-stamp limit, templates, previews, card-face localisation,
  the hero image, the second brand colour, the size-ceiling bug, the structural
  tests, and an explicit table of what a merchant still cannot set. The docs had
  **zero** coverage of this feature before.
- **`docs/ONBOARDING.md` — corrected.** It described a three-step flow; the wizard
  has four steps and had gained a `program` step the doc never mentioned. Now
  accurate, with a resume section.
- **`docs/INTERNATIONALIZATION.md` — corrected.** The false "100%" replaced with an
  accurate account including *why* it was wrong, plus a table of which background
  surface resolves which locale.
- **`docs/TESTING.md` — corrected.** Counts updated; new suites described; the e2e
  suite explicitly marked written-but-not-run rather than left implying it passes.
- **`docs/README.md`** — index updated.

Credential-dependent integrations are marked as such throughout, using the
established labels: *implemented / partial / planned / credential-dependent*.

**The 8%:** `STORE_EXPERIENCE.md` and `API.md` have not been re-read against
current code in these passes. `API.md` does not document the `kind=hero` upload
parameter added today.

---

# Overall completion

## **93%**

| Area | Score |
| --- | --- |
| Brand migration | 100% |
| Database / infrastructure | 100% |
| QR scanner separation | 100% |
| Onboarding resume | 100% |
| Landing demo | 100% |
| Wallet customization | 98% |
| Brand Kit | 97% |
| Localisation | 96% |
| Interactive onboarding | 95% |
| Subscriptions | 95% |
| Landing page | 93% |
| Documentation | 92% |
| Security | 88% |
| Mobile UX | 88% |
| Testing | 86% |
| Accessibility | 82% |
| Performance | 80% |
| Billing (credential-gated) | 75% |

Up from 91% in the previous revision. The increase is earned by clean-slate
migration reproducibility being *proven* rather than assumed, two half-wired brand
fields being finished, a silent image-size mismatch closed, and the third contrast
implementation removed with a structural guard against a fourth. Held back
primarily by the build and e2e suites not having been run.

# Launch readiness score

| Scenario | Score | Basis |
| --- | --- | --- |
| **Pilot cohort — hand-held first merchants** | **89 / 100** | A merchant can be onboarded, customise their card end to end including logo and banner, scan customers, and be billed manually today. Up 2: the schema is provably reproducible, and the two remaining "set it and nothing happens" fields are gone. Held back only by the unrun build/e2e. |
| **Public self-service launch** | **66 / 100** | Blocked on four accounts that do not exist — Stripe, Apple Wallet, Google Wallet, Resend — and on the fact that **no production deployment has ever run**. Neither is a code problem; neither is closable by writing more code. |

Not comparable to the 2026-08-01 audit's single 78/100, which predates the
infrastructure migration, the onboarding rebuild and every test suite that exists.

---

# Remaining issues

## Genuinely missing implementation

Only two items, both small:

1. **`coverUrl` renders nowhere.** Stored and editable, no surface. Finish it or
   remove the field — a half-wired field makes the rest of the screen suspect,
   which is exactly the reasoning applied to `heroImageUrl` and `secondaryColor`
   today.
2. **Server-side Zod validation messages are English.** Last-fallback only; the
   error envelope's `code` is translated first. Closing it means per-field error
   codes.

## Verification gaps — not code, but not nothing

3. **`pnpm build` has not been run against this tree.** The largest unknown here.
4. **`pnpm test:e2e` has not been run**, including the mobile viewport project.
5. **No accessibility audit** (axe / Lighthouse / screen reader) and no real-device
   mobile pass.
6. **No production deployment has ever run.** Everything in `docs/RAILWAY.md` is
   written from configuration, not experience.

## Credential-dependent — implemented, cannot be exercised

Each of these is complete in code and tested to the limit that is possible without
an account. None is missing implementation.

7. **Apple Wallet** — builder and `pass.json` complete and unit-tested; no
   certificates. `appleWalletConfigured()` returns false and the UI says so.
8. **Google Wallet** — class and object builders complete and unit-tested; no
   issuer account.
9. **Stripe** — checkout, portal, webhooks, idempotency and dunning complete; no
   key.
10. **Resend / SMTP** — every email path written and correctly localised; nothing
    can be delivered.
11. **S3 storage driver** — implemented, untested against a real bucket. The
    `local` driver is what development and a single-container deploy use.

## Accepted, documented

12. **No MFA, no OAuth** — documented as absent.
13. **`images: { unoptimized: true }`** with merchant images on three
    customer-facing surfaces. The 512 KB ceiling limits the damage.
14. **`components/ui/pagination.tsx` has English `aria-label`s** and is imported by
    nothing. Vendored shadcn primitive; needs localising only if it is ever used.
15. **No version control.** The repository is not a git repo. Every safeguard here
    — migration checksums, the type-enforced dictionary, the coverage floors,
    the structural tests — assumes a history that does not exist. The six dead
    email templates removed in the previous pass were backed up outside the
    project for exactly that reason. **`git init` is the cheapest risk reduction
    available and should happen before anything else on this list.**

---

# Recommended roadmap

### Immediately — make it provable

- **`git init` and a first commit.** Nothing below is safe without it.
- **`pnpm build`**, then **`pnpm test:e2e`** on both viewports. Fix what falls out.
- One **throwaway Railway deploy**, then tear it down, and correct
  `docs/RAILWAY.md` from what actually happened. The schema now provably rebuilds
  from empty, so this is a rehearsal rather than an experiment.

### Next — open the accounts, in this order

- **Stripe** first: it is the only one that unblocks *revenue* rather than a
  feature.
- **Apple Wallet** before Google: iOS is the larger wallet share in the target
  market.
- **Google Wallet**, then **Resend**.
- After each, exercise the corresponding path against real credentials once. The
  code is tested; the *integration* is not.

### Then — pilot cohort

- Three to five merchants, onboarded by hand, billed manually.
- Instrument the onboarding funnel. The resume logic is well tested but nobody has
  watched a real café owner use it between customers, which is the situation it
  was designed for.
- Decide `coverUrl` on evidence: finish it if a pilot merchant asks, delete it
  otherwise.

### Before public self-service

- Accessibility audit (axe + one screen-reader pass) and a real-device mobile pass.
- Per-field validation error codes, closing the last English-fallback path.
- Image optimisation with a CDN.
- Load-test the scan endpoint — highest-volume path, and its rate limiter is the
  only unbounded-growth surface in a request path.

### Deliberately not recommended

- **More features.** The product is feature-complete against its spec at 93%, and
  the two genuinely missing items are a colour field nothing renders and an error
  message nobody sees in normal use. The gap between "ready for a pilot" (89) and
  "ready for the public" (66) is four accounts, one deployment, and three
  verification runs. None of it is closable by writing more code.
