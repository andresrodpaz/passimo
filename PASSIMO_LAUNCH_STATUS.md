# Passimo — Launch Status

**Date:** 2026-09-04 (Wallet Designer discoverability pass)
**Previous revision:** 2026-08-28 (final recovery & completion pass)
**Supersedes:** the 2026-08-28 revisions, the 2026-08-27 revision, and `LAUNCH_AUDIT_REPORT.md` (2026-08-01, written under the Fidelio name)

This is the state after a resumed execution. The original session was interrupted
by a machine shutdown; subsequent passes recovered the tree, finished the
interrupted work, audited it, and — on 2026-09-04 — fixed three defects that no
audit had caught, because every audit so far had read the code rather than used
the product.

Every figure below was produced by a command run against this tree. Where
something was **not** verified, it says so and names what would verify it.

**Four claims in earlier revisions were wrong.** Three were corrected in the
2026-08-28 pass. The fourth is corrected here and is the most instructive of the
set: *"Wallet customization status: Complete. 98%"* was measured on the editor
and never on the merchant. The editor was complete; the feature was unreachable
from anywhere in the dashboard. See **Wallet Designer discoverability**.

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

The 2026-09-04 pass fixed a fifth defect of the same kind as the four below, and
the most expensive of the set: **the card designer could not be found.** It had
no route, no sidebar entry containing the word *card*, nothing on the dashboard
and nothing in the checklist. Every audit before this one read the code and
concluded the feature was complete; the first person to open the dashboard
looking for it could not find it. Fixed and verified end to end — see **Wallet
Designer discoverability**.

The four earlier defects were each invisible by construction — they produced no
error, no log line and no failing test:

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

### Verified on 2026-09-04

| Check | Result |
| --- | --- |
| `pnpm typecheck` | **Pass**, clean |
| `pnpm lint` | **Pass**, 0 errors, 0 warnings |
| `pnpm test` (unit) | **667 passed**, 27 files |
| `pnpm test:integration` (real PostgreSQL) | **82 passed**, 5 files |
| `pnpm build` (production) | **Pass.** `/dashboard/wallet/design` present in the route manifest. |
| `pnpm test:e2e` (Playwright, desktop + Pixel 7, against the production build and a live database) | **179 passed, 1 skipped** |
| The merchant journey, in a browser | Signup → dashboard → card designer → template → save → reload → still there, on both viewports and in both languages |
| Card design persistence, read back from PostgreSQL | Template, three colours, headline and a visibility toggle all survive; `customised` flips from false to true |
| Supabase dependency | **Zero** — nothing in `package.json`, nothing in first-party source |
| localhost development | Preserved. `env.appUrl` falls back to `http://localhost:3000` |

Verified in the 2026-08-28 pass and unchanged since:

| Check | Result |
| --- | --- |
| `pnpm db:reset` — drop schema, replay from empty | **22/22 migrations applied cleanly** |
| Fresh-schema spot check via `psql` | `wallet_card_designs`: 22 columns, 16 check constraints, PK on `business_id`. 11 brand columns on `businesses`. |
| `pnpm seed:demo` on the rebuilt database | 4 merchants (140–1,240 customers each) + platform admin |

### Still not verified

| Check | Why it matters |
| --- | --- |
| Tablet viewports (iPad, Android tablet) | `playwright.config.ts` has a phone project and a desktop project and nothing between them. The intermediate breakpoint is the same Tailwind grid, so this is missing coverage rather than a known defect. |
| Lighthouse / axe audit | No tooling run. The accessibility and performance sections are inspection-based and say so. |
| Real Apple / Google pass issuance | Credential-dependent. No certificates or issuer account exist on this deployment; the product says so on screen rather than implying otherwise. |

**Corrections to earlier revisions.** The 2026-08-28 revision listed
`pnpm build` and `pnpm test:e2e` as the two largest unknowns in this document.
Both have now been run against this tree and both pass; those rows are gone
rather than quietly softened.

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

# Wallet Designer discoverability

**Date of this pass:** 2026-09-04.
**Status: fixed and verified against a live database.**

## The previous problem

Reported from manual verification: *"The Wallet Card Designer was previously
implemented according to the product requirements, but during manual
verification I cannot find it anywhere in the merchant dashboard."*

That report was correct, and the section below it in this document — *Wallet
customization status: Complete. 98%* — was wrong in the way that matters. The
editor was complete. The **feature** was not, because a merchant could not reach
it.

Searching the dashboard as a merchant would, the terms that returned nothing
were: *Wallet Card Designer*, *Card customization*, *Wallet design*, *Apple
Wallet design*, *Google Wallet design*, *Customize card*. The one row anywhere in
the product that used the word "card" — the checklist's *"Personalise the card"* —
linked to Settings, which does not contain the card designer.

## Root cause

Of the seven possibilities in the report, the true one was **"the feature exists
but has no navigation entry"**, compounded by four others. Determined by reading
the code, not the previous audits:

| Claim | Verdict |
| --- | --- |
| Feature is actually incomplete | **False.** `components/wallet/card-designer.tsx` (716 lines), 11 templates, `wallet_card_designs` since migration `000021`, `GET`/`PATCH`/`POST /api/v1/wallet/design`, live preview through the real `resolveCardDesign`. All working. |
| No navigation entry | **True.** No sidebar row, in either language, contained the word *card*. |
| Hidden behind an unintuitive route | **True.** It had no route at all. It was the first `TabsTrigger value="design"` of `/dashboard/wallet`, whose sidebar label was *"Wallet & proximity"*, in the group *"Configure"*, last in the list. A tab has no URL, so **nothing could link to it.** |
| Not linked from the dashboard | **True.** `app/dashboard/page.tsx` had no reference to the card. Neither did the first-steps checklist. |
| Only during onboarding | **False**, but onboarding made it worse: the card step's help text said *"…are in the card designer, whenever you want them"* and the final screen said *"Fine-tune the card in the designer"* — naming a screen with no link and no findable location. Telling a merchant a feature exists without saying where is worse than silence. |
| Permissions or plan gating hide it | **False.** Gated on `wallet:read` / `wallet:write` only, which owner, admin and manager all hold. No `feature` flag, so no plan gate — now asserted in `tests/unit/dashboard-navigation.test.ts`. |
| UI entry is unclear | **True**, and the deepest cause: three separate surfaces (`/dashboard/wallet` tabs, Settings → Card, the Brand Kit panel) each partly answered "where do I change my card", and none said *card design* anywhere a merchant looks first. |

The one-sentence version: **the editor was a tab, tabs have no address, and
nothing without an address can be linked to, labelled, or found.**

## Changes implemented

| # | Change | Files |
| --- | --- | --- |
| 1 | **The designer got its own route** — `/dashboard/wallet/design`, headed *"Your Wallet card"* over *"Design the digital loyalty card your customers will save to Apple Wallet and Google Wallet."* | `app/dashboard/wallet/design/page.tsx` (new) |
| 2 | **The design tab was removed, not duplicated.** `CardDesignPanel` has exactly one mount point. Two URLs rendering one editor is the duplication that hid the problem in the first place. | `app/dashboard/wallet/page.tsx`, `components/wallet/design-panel.tsx` |
| 3 | **The sidebar gained a group called "Your card"**, whose first row is **"Card design"** (`Diseño de la tarjeta`). Navigation moved into a pure, testable module. | `lib/dashboard/navigation.ts` (new), `app/dashboard/layout.tsx` |
| 4 | **Active-route matching now takes the longest prefix.** Without it `/dashboard/wallet/design` highlighted two sidebar rows and titled the page "Wallet & proximity". | `lib/dashboard/navigation.ts` |
| 5 | **A dashboard callout** showing the merchant's *real* card — resolved through the same function the pass builder uses — with *Customise card* under it. First-time copy: *"Your card is ready to customise"* / *"Design your card"*. | `components/wallet/card-callout.tsx` (new), `app/dashboard/page.tsx` |
| 6 | **The same callout heads the Wallet screen**, above the tabs, so the screen a merchant plausibly opens first leads out to the editor. | `app/dashboard/wallet/page.tsx` |
| 7 | **A Quick Start row** — *"Customise your Wallet card"* → the editor, second in the list, no plan gate. The old *"Personalise the card"* row was reworded to *"Add your logo and brand colours"* and repointed from Settings to the Brand tab, so the two stop competing. | `lib/onboarding/checklist.ts` |
| 8 | **A `customised` fact**, derived not stored: *a design row exists AND `updated_at > created_at`*. Row-exists would be wrong (onboarding writes a seeded design for everyone) and value-comparison would be wrong (the seed is per-trade). One function feeds both the callout and the checklist, so they cannot disagree. | `lib/wallet/card-design-store.ts`, `app/api/v1/wallet/design/route.ts`, `app/api/v1/onboarding/route.ts` |
| 9 | **Onboarding's three closing suggestions became links**, led by *"Customise your Wallet card"*. The card step's help text now names the destination: *"…live in Your card → Card design in your dashboard"*. | `app/onboarding/page.tsx` |
| 10 | **Settings → Card** *"Open card designer"* now points at the designer instead of at the screen that used to contain it. | `app/dashboard/settings/page.tsx` |
| 11 | **`?tab=` on the Wallet screen**, so the designer's "Brand kit" link lands on the right tab rather than the first one. Recorded with `replaceState`, so reading three tabs does not cost three history entries. | `app/dashboard/wallet/page.tsx` |
| 12 | **The template gallery got an `id`**, so *"Browse templates"* lands on the gallery rather than the top of a long editor. | `components/wallet/card-designer.tsx` |
| 13 | **The landing demo gained its own CTA** — *"Create your loyalty program"* under the interactive card, with *"No account needed to play with the demo above."* Somebody who has just watched the card follow their colour choice should not have to scroll back to the hero to act on it. | `components/landing/landing-page.tsx` |

Route audit: no dead or duplicated designer routes remain. Every component under
`components/wallet/` has at least one importer. `/api/v1/wallet/preview` is the
campaign preflight endpoint used by the campaigns panel, not a card route.

### Two defects found by looking at the screens, not by asserting on them

Both were caught by screenshotting the finished work on a phone and a desktop and
reading it as a merchant would. Neither would have failed any test that existed,
which is the same class of problem as the one this pass set out to fix.

| # | Defect | Fix |
| --- | --- | --- |
| 14 | **The checklist ticked "Add your logo" on day one**, struck through, for a merchant who had uploaded nothing. `brandingCustomised` accepted "a colour that differs from the platform default" — and signup provisions a *trade-appropriate* palette, so a café is seeded brown and nothing ever matches the default. Every merchant arrived with a completed item they had not completed. | The fact is now the logo and only the logo — the one thing in that item nobody can seed for them. Colour work is judged by the card-design row instead. The item was renamed to match. Guarded by an e2e assertion that a seconds-old account reads "0 of 6 done". |
| 15 | **On a phone, Save sat above every control.** The preview column is `order-1` on narrow screens, deliberately — a merchant should see what they are editing before the controls — which put the save button at the top, so after scrolling down through templates, colours, toggles and copy the only way to save was to scroll all the way back up. | A sticky action bar after the controls on mobile (`order-3 sticky bottom-4`), with the desktop copy still under the sticky preview. One element, rendered in two slots, so there is nothing to keep in step. Guarded by an assertion that Save is in the viewport once the last field is. |

The checklist also gained an accessible name, so it is announced as a landmark
rather than as an anonymous `<section>` — which is what an unnamed one is, to a
screen reader and to a role-based test alike.

## Merchant access path

Verified in a browser against a live database:

```
sign in → dashboard
            ├── sidebar    YOUR CARD → Card design             1 click
            ├── callout    "Your Wallet card" → Customise card 1 click
            └── checklist  "Customise your Wallet card"        1 click
```

Answering the acceptance question — *"I want to customise the loyalty card my
customers will save to their Wallet. Where do I click?"* — there are three
answers on the first screen after sign-in, all one click, and one of them is a
picture of their own card.

Six entry points in total; the other three are the Wallet screen (2 clicks), the
end of onboarding (1) and Settings → Card (3). All six use the exported
`CARD_DESIGNER_HREF` constant, so the route is written once.

## Mobile status

**Verified.** The Playwright `mobile` project (Pixel 7) runs every journey test
in the new spec, including an assertion that the designer produces **no
horizontal overflow** — a colour picker off the side of the screen is a control
that does not exist. The editor stacks preview-first (`order-1`) on narrow
screens so the merchant sees what they are editing before the controls, and the
save button stays reachable.

Not verified: iPad and Android tablet, which have no project in
`playwright.config.ts`. The layout between the phone and desktop breakpoints is
the same Tailwind grid, so this is a gap in coverage rather than a known defect —
and it is stated here rather than glossed.

## Localization status

**Verified, in both directions.** Every string added in this pass exists in `en`
and `es`; the dictionary's shape is the type contract, so a missing Spanish key
is a build error rather than a half-English page.

Checked live at `/dashboard/wallet/design` and `/dashboard/wallet` in both
locales, asserting both that the expected strings are **present** and that the
other language's strings are **absent**. The second half is what catches the real
failure mode: a screen built from thirty `t()` calls that renders twenty-nine and
leaves one English literal behind is invisible to a test that only looks for what
should be there. `Personaliza tu tarjeta`, `Vista previa`, `Guardar diseño` and
`Color principal` all resolve. The Spanish assertion is now permanent, in
`tests/e2e/wallet-card-designer.spec.ts`.

## Testing status

Run on 2026-09-04 against this tree, with PostgreSQL up:

| Command | Result |
| --- | --- |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass, no warnings |
| `pnpm test` | **667 passed**, 27 files |
| `pnpm build` | pass; `/dashboard/wallet/design` present in the route manifest |
| `pnpm test:e2e` — the whole suite, both viewports | **179 passed, 1 skipped** (the skip is a mobile-only test under the desktop projection) |

New coverage:

- `tests/unit/dashboard-navigation.test.ts` — assertions about *reachability*,
  which is the property that was broken: the designer has an entry, its label
  contains *card* in both dictionaries, it precedes the proximity screen, it has
  no plan gate, every role with `wallet:read` sees it, every sidebar href
  resolves to a real `page.tsx`, and longest-prefix matching works.
- `tests/unit/onboarding-checklist.test.ts` — extended: the card row is second,
  points at the designer, is offered on every purchasable plan, and does not tick
  when the *brand* is customised.
- `tests/e2e/wallet-card-designer.spec.ts` — the journey, plus save → reload →
  still-there, both wallet previews present and labelled as previews, mobile
  overflow, and the Spanish render.

Persistence was also verified directly against the database rather than inferred:
a fresh workspace reports `customised: false`; after applying the `luxury`
template and patching colours, headline and a visibility toggle, a re-read
returns `template: luxury`, `background: #123456`, `accent: #abcdef`,
`headline: "Cafe Verify"`, `showTier: false`, `customised: true`, and
`GET /api/v1/onboarding` reports `cardDesignCustomised: true` from the same
source. No local-only state.

One test-quality fix was needed on the way: signing in per test spent the `auth`
rate limit (8 requests / 5 minutes / IP) before the file's last assertion, so
inside the full suite this spec failed on our own security control rather than on
the product. The session is now established once and replayed.

## Remaining limitations

Stated rather than implied:

1. **No real Apple or Google pass is issued on this deployment.** Unchanged and
   credential-dependent. The designer says so itself, deriving the claim from
   `walletService().status()` rather than assuming it. The design *is* saved and
   will be used the moment credentials exist.
2. **Tablet viewports are not in the e2e matrix.** See *Mobile status*.
3. **One design per business.** The primary key on `wallet_card_designs` is
   `business_id`; per-location card variants remain out of scope.
4. **`coverUrl` still renders nowhere** — the one remaining half-wired brand
   field, unchanged by this pass.
5. **`customised` is a proxy, not a record of intent.** A merchant who reopens
   onboarding and re-activates their card counts as having customised it. They
   did change something, so the tick is defensible, but it is a heuristic and
   worth knowing.

---

# Wallet customization status

**Editor: complete. Discoverability: was 0%, fixed 2026-09-04 — see the
section above.**

The "98%" this section previously claimed was measured on the editor alone,
and was misleading as a result: a control a merchant cannot reach is not a
feature they have. It is deliberately not restated as a percentage.

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

**Updated 2026-09-04: the mobile project has now been run.** The full Playwright
suite passes on the Pixel 7 projection against a production build — 179 passed, 1
skipped across both projects — including two horizontal-overflow assertions: the
public flows (`public.spec.ts`) and the card designer, which is the densest
merchant screen in the product and the one most likely to break at 412 px.

**Remaining caveat:** no tablet project exists, and there has been no real-device
pass. The number stays at 88% because the phone and the desktop are measured and
everything between them is still inferred.

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

**Good. The hole is closed. 93%.**

Every row below was run on 2026-09-04 against this tree, with PostgreSQL up and
a production build serving on `localhost:3000`.

| Suite | Result |
| --- | --- |
| Unit — `pnpm test` | **667 passed, 27 files** |
| Integration — `pnpm test:integration` (real PostgreSQL) | **82 passed, 5 files** |
| `pnpm typecheck` | Clean |
| `pnpm lint` | Clean — 0 errors, 0 warnings |
| `pnpm build` | Clean |
| End-to-end — `pnpm test:e2e`, both viewports | **179 passed, 1 skipped.** The skip is a mobile-only test under the desktop projection. |

**The e2e hole from the previous revision is closed.** That revision said
"`tests/e2e/merchant-journey.spec.ts` (326 lines) walks the full flow and has not
been executed against this tree". It has now been executed, along with every
other spec, on both the desktop and Pixel 7 projections, against a real database.
Nothing failed.

Running it surfaced one thing worth recording, because it is the kind of failure
that reads as a product bug and is not: the new designer spec signed in once per
test, which spent the `auth` rate limit (8 requests / 5 minutes / IP) before the
file's last assertion. Inside the full suite it therefore failed on our own
security control. Fixed by establishing the session once and replaying its
cookies — which is also closer to what a merchant does.

**174 tests added across the three passes** (493 → 667), covering features that
had none:

| File | Tests | Covers |
| --- | --- | --- |
| `wallet-card-design.test.ts` | 66 | Hex parsing; WCAG ratios against published values; the AA guarantee across every pairing; the gradient two-stop rule and its documented irreconcilable fallback; progress-style resolution and its 12-stamp boundary; row mapping and enum fallback; Brand Kit mapping; handle normalisation; patch building; **luminance implemented exactly once** |
| `wallet-pass-build.test.ts` | 35 | Apple `pass.json` and Google class/object structure; the ten-location cap and widest-radius `maxDistance`; locale-correct dates; **upload ceiling equals embed ceiling**; a guard that no English phrase survives on a Spanish pass |
| `email-shell.test.ts` | 21 | The shell agreeing with the card on text colour; `lang`; translated footer; HTML escaping of merchant copy |
| `landing-demo.test.ts` | 32 | The demo loop; repeat cycles; points surviving redemption; all 24 trade/palette combinations legible |
| `dashboard-navigation.test.ts` | 13 | Added 2026-09-04. Whether the card designer can be *reached*: a sidebar entry exists, its label contains *card* in both dictionaries, it precedes the proximity screen, it carries no plan gate, every role with `wallet:read` sees it, every sidebar href resolves to a real `page.tsx`, and longest-prefix route matching works |
| `onboarding-checklist.test.ts` | +7 | Added 2026-09-04. The card row is second, points at the designer, is offered on every purchasable plan, and does not tick when the *brand* is customised |
| `wallet-card-designer.spec.ts` (e2e) | 11 × 2 viewports | Added 2026-09-04. Sidebar → designer, dashboard callout → designer, both wallet previews present and labelled as previews, template applied → saved → reloaded → still there, no horizontal overflow and a reachable Save on a phone, a day-one checklist with nothing falsely ticked, and the Spanish render with no English left behind |

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

**What is still not covered.** Tablet viewports — `playwright.config.ts` has a
phone and a desktop project and nothing between them. The camera path in the
scanner cannot be driven by Playwright at all and is exercised through the manual
panel instead, which is the fallback the counter is built to survive.

## Merchant journey — verified where it can be, honestly labelled where it cannot

| Step | Verification |
| --- | --- |
| Signup, session lifecycle, lockout, revocation | **Verified** — real PostgreSQL |
| Business creation and provisioning | **Verified** — integration suite, on a schema rebuilt from empty |
| Program → plan → shop → card → activate | **Verified end to end** — walked in a browser on both viewports, 2026-09-04 |
| Brand Kit configuration, wallet customization, preview | **Verified end to end** — schema, store and resolver tested; the designer opened, edited, saved, reloaded and re-read from the database in a browser |
| **Finding** the card designer as a new merchant | **Verified end to end** — sidebar, dashboard callout and checklist all reach it in one click, on both viewports and in both languages |
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
- **`docs/TESTING.md` — corrected twice.** Counts updated; new suites described.
  The 2026-08-28 pass marked the e2e suite written-but-not-run rather than
  implying it passed; the 2026-09-04 pass ran it and replaced that with the real
  numbers, added `wallet-card-designer.spec.ts` and `demo-plans.spec.ts` to the
  file table, and wrote down the auth-rate-limit pattern a new spec has to follow
  to avoid failing on our own security control.
- **`docs/README.md`** — index updated.

Added 2026-09-04:

- **`docs/BRAND_AND_CARD_DESIGN.md` §2 — "Where the designer lives, and how a
  merchant finds it".** The route, the six entry points and their click counts,
  the `customised` derivation and why the two obvious alternatives are both
  wrong, the naming decision, and what guards it. Every other section number
  shifted by one and the cross-references moved with them.

Credential-dependent integrations are marked as such throughout, using the
established labels: *implemented / partial / planned / credential-dependent*.

**The 8%:** `STORE_EXPERIENCE.md` and `API.md` have not been re-read against
current code in these passes. `API.md` documents neither the `kind=hero` upload
parameter nor the `customised` field now returned by
`GET /api/v1/wallet/design`.

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

Two of the four gaps listed here in the previous revision are closed: `pnpm build`
and `pnpm test:e2e` have both been run against this tree, on both viewport
projects, against a live database. What remains:

3. **No tablet viewport in the e2e matrix.** `playwright.config.ts` has a Pixel 7
   and a Desktop Chrome project. iPad and Android tablet widths sit between them
   and are not exercised.
4. **No accessibility audit** (axe / Lighthouse / screen reader) and no
   real-device mobile pass. Landmarks, labels, roving tabindex on the preview
   switch and horizontal-overflow are asserted by Playwright; nothing measures
   contrast or announcement quality end to end.
5. **No production deployment has ever run.** Everything in `docs/RAILWAY.md` is
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
