# Brand Kit and wallet card design

How a merchant makes the product look like their business, without writing code.

This document describes what the code does today. Where something is partial or
credential-dependent, it says so in those words.

---

## 1. The three layers, and why they are separate

Merchants think about these separately, and mixing them is what makes loyalty
dashboards unusable. The code keeps them apart deliberately:

| Layer | Question it answers | Owner |
| --- | --- | --- |
| **Brand Kit** | Who is this business? | `lib/brand/kit.ts` |
| **Card design** | How does the card look? | `lib/wallet/card-design.ts` |
| **Behaviour** | When does the card notify? | `lib/wallet/settings.ts` |

A colour belongs to the brand. A *gradient* belongs to the card. A geofence
radius belongs to neither.

Both the Brand Kit and the card design modules are **isomorphic** — no
`server-only`. The designer's live preview and the real pass builder resolve the
same values through the same functions. A preview that renders through a second,
parallel implementation is a preview that lies the first time the two drift.

---

## 2. Where the designer lives, and how a merchant finds it

**Status: implemented.** This section exists because the answer used to be *"they
don't"*.

Everything in §3 through §7 shipped complete — the editor, eleven templates,
Apple and Google previews rendering through the real resolver, a working
endpoint, a migration, and passing tests — and it was reachable only as the
**first tab** of `/dashboard/wallet`, a screen the sidebar labelled *"Wallet &
proximity"* under a group called *"Configure"*. Nothing in the navigation, the
dashboard, or the first-steps checklist contained the word **card**. A merchant
who wanted to change their loyalty card had no way to find out where to click,
and a feature nobody can reach is not shipped however good the editor is.

### The route

| | |
| --- | --- |
| **Route** | `/dashboard/wallet/design` |
| **Page** | `app/dashboard/wallet/design/page.tsx` |
| **Heading** | *Your Wallet card* — "Design the digital loyalty card your customers will save to Apple Wallet and Google Wallet." |
| **Editor** | `components/wallet/design-panel.tsx` → `components/wallet/card-designer.tsx` |
| **Endpoint** | `GET`/`PATCH`/`POST /api/v1/wallet/design` |
| **Permission** | `wallet:read` to open, `wallet:write` to save |
| **Plan gate** | **None.** Included on every purchasable plan, from Starter at €5/month. There is no free plan. |

The editor has exactly **one** mount point. The designer was not copied to the
new route — it was moved, and the old tab is gone. Two URLs rendering the same
editor is the duplication that made the original problem hard to see.

### The five ways in

| Entry point | Where | Clicks from sign-in |
| --- | --- | --- |
| **Sidebar** — *Your card → Card design* | `lib/dashboard/navigation.ts` | 1 |
| **Dashboard callout** — *Your Wallet card*, with a live preview of the real design | `components/wallet/card-callout.tsx`, on `app/dashboard/page.tsx` | 1 |
| **First-steps checklist** — *Customise your Wallet card* | `lib/onboarding/checklist.ts` | 1 |
| **Wallet screen** — the same callout, above the tabs | `app/dashboard/wallet/page.tsx` | 2 |
| **End of onboarding** — *Customise your Wallet card* in "When you have a minute" | `app/onboarding/page.tsx` | 1 |
| **Settings → Card** — *Open card designer* | `app/dashboard/settings/page.tsx` | 3 |

`CARD_DESIGNER_HREF` is exported from `components/wallet/card-callout.tsx` and
used by every one of these, so the route is written once.

### The callout, and the one fact it needs from the server

`WalletCardCallout` shows the merchant's **real** saved design, resolved through
`resolveCardDesign`. A generic illustration would have been easier and would have
taught the merchant nothing; the point of putting it on the dashboard is that
they recognise the card as theirs.

Its copy changes on `customised`, returned by `GET /api/v1/wallet/design` and
derived by `getCardDesignRecord`:

```
customised = a design row exists AND updated_at > created_at
```

Not *"does a row exist"*: onboarding writes a full, trade-seeded design when the
merchant activates their card, so every account has a row from day one and that
test would always answer yes. Not *"does it differ from the platform default"*
either, because that seed is per-trade — a café's card legitimately arrives
already brown and stamped. `updated_at > created_at` is exactly *"this has been
edited since it was first written"*, which is the question being asked.

The same function feeds the checklist's `cardDesignCustomised` fact, so the
ticked row and the dashboard callout can never disagree.

### Naming

The navigation says **Card design** (`Diseño de la tarjeta`), not *"Pass
configuration"* or *"Wallet Card Designer"*. A merchant scans the sidebar for the
word *card*; under a *"Your card"* group heading that is the first word they read.

### What guards it

`tests/unit/dashboard-navigation.test.ts` asserts reachability rather than
rendering, because rendering was never the broken part: the designer has a
sidebar entry, its label contains *card* in both dictionaries, it sits above the
proximity screen, it carries no plan gate, every role with `wallet:read` sees it,
and every sidebar href resolves to a `page.tsx` that exists.

`tests/e2e/wallet-card-designer.spec.ts` walks the journey — sign in, read the
dashboard, click the obvious thing, change a template, save, reload, and check
the change survived.

---

## 3. Brand Kit

**Status: implemented.**

One record of who the business is, stored on the `businesses` row rather than in
a table of its own — because it *is* the business, and splitting it out would
create the second source of truth that migration `000021` existed to remove.

### What it holds

| Group | Fields |
| --- | --- |
| Identity | `name`, `description` |
| Imagery | `logoUrl`, `iconUrl`, `coverUrl` |
| Colour | `primaryColor`, `secondaryColor`, `accentColor`, `textColor` |
| Type | `font` (merchant surfaces; the card has its own setting) |
| Contact | `email`, `phone`, `website`, `address`, `city`, `postalCode`, `country` |
| Social | `instagram`, `facebook`, `tiktok` |

### The bug it fixed

`businesses.primary_color` was the brand, but `wallet_settings.brand_color` also
existed and was consulted **first** when building a pass. A merchant who set a
colour on the Settings screen and later opened the Wallet screen had two answers
to one question, with the less discoverable one winning. Migration `000021` made
`businesses` authoritative, copied any stray `wallet_settings.brand_color` into
the design row, and made `lib/brand/kit.ts` the only reader.

### Social handles

Merchants paste whatever their phone gives them — a full URL, an `@handle`, or
the bare username. `normalizeHandle` reduces all three to a bare username, so the
card back and the public page can build their own links. A paste containing
whitespace or an illegal character is rejected rather than stored, because
storing it would render a broken link on a customer's card.

### Where it is read

| Surface | Path |
| --- | --- |
| Wallet pass (Apple + Google) | `lib/wallet/pass-content.ts` → `mapBrandKit` |
| Public join page | `app/join/[businessSlug]/page.tsx` → `resolveBrandPalette` |
| Browser card | `app/card/[token]/page.tsx` → `resolveBrandPalette` |
| Public gift shop | `app/gift/[slug]/page.tsx` → `resolveBrandPalette` |
| Outbound email | `lib/messaging/email-layout.ts` → `emailBrandFromRow` |
| Designer + Brand panel | `components/brand/brand-kit-panel.tsx` |

`resolveBrandPalette` and `emailBrandFromRow` exist because each of those
surfaces previously inlined its own `?? '#111827'` / `?? '#f59e0b'` /
`?? '#ffffff'` chain against the raw row. That had two costs: changing the
platform fallback was a four-file edit, and — more seriously — they used the
*stored* `text_color` verbatim while the card resolver only honours a stored
foreground that passes contrast. The same two columns therefore produced a
legible wallet card and an illegible join page.

---

## 4. Card design

**Status: implemented.** Stored in `wallet_card_designs`, one row per business.
A **missing row is the default design**, not an error.

### The model

| Field | Values | Notes |
| --- | --- | --- |
| `template` | see §6 | A set of starting values, not a mode |
| `cardStyle` | `solid`, `gradient`, `duotone`, `frosted` | Surface treatment |
| `progressStyle` | `auto`, `bar`, `stamps`, `points`, `none` | See §5 |
| `typography` | `system`, `rounded`, `serif`, `mono` | |
| `backgroundColor`, `foregroundColor`, `accentColor` | hex or null | Null means *inherit the brand* |
| `logoUrl`, `heroImageUrl` | URL or null | Logo falls back to the brand's |
| `showMemberName`, `showMemberSince`, `showTier`, `showLocation`, `showReward`, `showProgress` | boolean | What appears on the face |
| `headline`, `customMessage`, `termsText` | text or null | The merchant's own copy |

An absent boolean defaults to **shown**. A row written before a toggle existed
must not blank a field on an already-installed card.

Out-of-range enum values coming back from the database fall back to the default
rather than being trusted — `mapCardDesign` validates rather than casts.

### Resolution

`resolveCardDesign(design, brand, program)` collapses the layers into a
`ResolvedCardDesign` with no nulls. The fallback chain is short and always ends
somewhere valid:

```
design → brand kit → a legible default
```

The foreground has one extra rule, and it is the most important behaviour in the
module: **a stored text colour is honoured only if it is actually readable.**

Merchants change their background far more often than their text colour. The
pair that was legible in March stops being legible in April without anyone
touching the text setting — and the result ships to every installed pass. So
`resolveCardDesign` checks WCAG AA (4.5:1, the body-copy threshold, not the
3:1 large-text one) and recomputes black-or-white from the background when the
stored value fails.

If neither layer states a foreground, one is *computed* rather than defaulting to
white — so a merchant who picks a cream background gets dark text without ever
learning what contrast means.

---

## 5. Progress rendering

`progressStyle: 'auto'` follows the program, which is right almost always: a
stamp card gets stamps, a points program gets a bar.

The override exists because "almost" is doing real work. `auto` resolves as:

| Program | Resolves to |
| --- | --- |
| No goal, or goal ≤ 0 | `points` |
| Stamp program, goal ≤ `MAX_RENDERABLE_STAMPS` (12) | `stamps` |
| Anything else with a goal | `bar` |

Twelve is where stamps stop being readable — two rows of six on the narrowest
card, without the dots dropping below a touch-sized target. A stamp program with
a goal of 40 renders as forty pinheads, and the merchant is the one who can see
that, which is why the override is a real setting.

Stamp-vs-points is classified on `loyalty_programs.type`, **not** on the unit
label. A Spanish café's unit is `sellos`; matching on the word would classify
every localised stamp card as a points program and quietly stop drawing stamps.

---

## 6. Templates

`lib/wallet/card-templates.ts`. The brief was "templates should feel genuinely
different — do not create ten copies of the same design". **A palette swap is not
a template**, so each varies on four axes at once (surface, progress, typography,
visible rows) and is anchored to how that trade actually operates:

- a café's customer is counting to six → stamps, tier hidden;
- a gym's member is on a plan → the tier is the point, the stamp grid is meaningless;
- a restaurant's guest accrues spend → a points bar;
- a luxury retailer wants a tier and almost nothing else on the face.

A merchant picks one and edits from there. Nothing is locked.

The landing page's customisation demo renders the **same** template definitions
(`lib/landing/demo.ts` → `demoCardDesign`). A marketing mock-up of a template the
designer cannot produce is a promise broken on the merchant's first afternoon.

---

## 7. Previews

`components/wallet/card-preview.tsx`, with `components/wallet/platform-switch.tsx`
toggling between the two platform framings.

**The preview is not a mock.** It renders through `resolveCardDesign` — the same
function the pass builder calls — so what a merchant sees while dragging a colour
picker is what their customer gets.

It shows an Apple Wallet-style and a Google Wallet-style layout, a QR/barcode
representation, customer information, loyalty balance, rewards and branding.

**It is labelled as a preview and does not claim to be a real provider pass.**
That matters for a reason beyond honesty: without Apple and Google credentials
(§9) no real pass can be issued at all, and a preview implying otherwise would
misrepresent what the deployment can do.

Previews appear in five places, all sharing the component:

| Where | Purpose |
| --- | --- |
| `app/dashboard/wallet/design/page.tsx` | The designer (§2) |
| `app/dashboard/page.tsx` | The dashboard callout — the merchant's real card, as a way in |
| `app/dashboard/settings/page.tsx` | The Settings → Card summary |
| `app/onboarding/page.tsx` | The card being built, live, during setup |
| `components/landing/*` | The public customisation demo, which uses no camera |

Before a business exists, `placeholderBrandKit(name)` supplies a neutral,
complete kit so the preview never renders half-resolved.

---

## 8. Localisation of the card face

**Status: implemented.**

Every fixed string the card prints is resolved once in `buildPassLabels`
(`lib/wallet/pass-content.ts`) and carried on `WalletPassContent.labels`. Both
providers render from it; neither reaches for a literal.

The locale is the **business's** (`businesses.locale`, via
`getBusinessLocale`), never the viewer's. Nobody is viewing anything when a pass
is built, and a card is installed once and read for months.

Dates go through `passLocaleTag` / `formatPassDate` in `lib/wallet/pass-format.ts`
— one implementation shared by the content builder and both providers.

This replaced English literals in `apple-pass.ts` and `google-loyalty-jwt.ts`,
which had meant a Spanish café's customers carried a card labelled
`MEMBER` / `SINCE` / `TO GO` with `en-GB` dates. It is the most permanent surface
the product has and the only one a merchant cannot correct from the dashboard.

Google's `language` tags on `localizedIssuerName` and image
`contentDescription` are the business's too. Google reads those to decide what a
screen reader announces; declaring Spanish copy as English made the
accessibility label wrong on every Android phone that installed the card.

---

## 9. What is not finished

| Item | Status |
| --- | --- |
| Issuing a real Apple `.pkpass` | **Credential-dependent.** The builder and its `pass.json` structure are complete and unit-tested; no Apple certificates exist on this deployment. `appleWalletConfigured()` reports false and the UI says so. |
| Issuing a real Google pass | **Credential-dependent.** Class and object builders are complete and unit-tested; no issuer account exists. |
| Logo upload | Implemented via `lib/brand/logo.ts` and `lib/storage/*` (`local` and `s3` drivers). The `s3` driver is untested against a real bucket. |
| Hero/strip image | **Implemented.** Upload control in the designer, rendered in both previews, consumed by both providers (Apple `strip.png`, Google `heroImage`). See §12. |
| `secondaryColor` | **Implemented.** Drives the far stop of a `gradient` card. See §13. |
| Per-location card variants | **Not implemented.** One design per business — the primary key on `wallet_card_designs` is `business_id`. |
| Cover image (`coverUrl`) | **Stored and editable, renders nowhere.** The one remaining half-wired brand field. |

---

## 10. Tests

| Suite | Covers |
| --- | --- |
| `tests/unit/wallet-card-design.test.ts` | Hex parsing, WCAG contrast, the AA guarantee across every background/foreground pairing, progress-style resolution and its boundary at 12, row mapping and enum fallback, Brand Kit mapping, handle normalisation, patch building, `resolveBrandPalette` agreeing with the card resolver |
| `tests/unit/wallet-pass-build.test.ts` | Apple `pass.json` and Google class/object structure, the location cap and `maxDistance`, locale-correct dates, and a guard asserting no English phrase appears on a Spanish pass |
| `tests/unit/email-shell.test.ts` | The email shell agreeing with the card on text colour, `lang`, translated footer, HTML escaping |
| `tests/unit/landing-demo.test.ts` | The demo state machine, and that all 24 trade/palette combinations resolve to a legible card |
| `tests/unit/dashboard-navigation.test.ts` | That the designer is *reachable* — sidebar entry, label, ordering, no plan gate, every role with `wallet:read`, and every nav href resolving to a real page (§2) |
| `tests/unit/onboarding-checklist.test.ts` | That "Customise your Wallet card" is the checklist's second row, points at the designer, and is offered on every purchasable plan |
| `tests/e2e/wallet-card-designer.spec.ts` | The merchant journey: sidebar → designer, dashboard callout → designer, both wallet previews present and labelled, template applied, saved, reloaded and still there, and no sideways scroll on a phone |

Two assertions are structural rather than behavioural, and both exist because the
bug they guard is a *duplicate* — something no test of any single function can
see:

- **Luminance is implemented once.** `wallet-card-design.test.ts` reads the source
  tree and asserts the WCAG coefficients appear in `card-design.ts` and nowhere
  else. Three copies once existed simultaneously — there, in the email shell, and
  in `components/loyalty-card.tsx` — each claiming WCAG in a comment while
  computing an ungamma'd channel average. They disagreed, so one brand colour
  produced white text on the installed pass and dark text on the join page
  advertising it.
- **The upload ceiling equals the embed ceiling.** `wallet-pass-build.test.ts`
  asserts `MAX_LOGO_BYTES === MAX_PASS_IMAGE_BYTES`. See §11.

Run: `pnpm test`.

---

## 11. The hero/banner image

**Status: implemented.**

Apple prints it as `strip.png`, Google as `heroImage`. Both providers had been
consuming `wallet_card_designs.hero_image_url` since migration `000021` while
**nothing could set it and nothing rendered it** — a column a merchant could only
reach by editing the database.

| Piece | Where |
| --- | --- |
| Upload | `POST /api/v1/brand/logo?kind=hero` |
| Storage key | `storageKeys.businessHero` — content-fingerprinted, tenant-scoped |
| Control | `LogoField` with `HERO_COPY` (wide thumbnail, `object-cover`) |
| Preview | `HeroStrip` in `card-preview.tsx`, in both platform framings |

One route serves both images because the work is identical — sniff the bytes,
fingerprint, store public, invalidate installed passes — and only the destination
differs. That also means the hero upload inherits the logo route's auth,
`settings:write` permission, `upload` rate limit and tenant scoping rather than
re-deriving them.

The destinations differ deliberately: the **logo** is identity and is written to
the Brand Kit; the **hero** is card styling and is written to the card design.
Putting the strip image on the brand because the upload shares a route would
recreate the conflation migration `000021` removed.

### The size ceiling, and the bug it closed

`MAX_LOGO_BYTES` was 2 MB while `fetchImage` in `apple-pass.ts` refused anything
over a bare `512_000`. A merchant could upload a 1.5 MB logo, see it accepted, see
it on the Brand screen and on their join page — and have it **silently absent from
every wallet pass**, which is the surface they uploaded it for. Silent, because a
dropped image is not an error: the pass builds fine without one, so nothing would
ever have reported it.

`MAX_PASS_IMAGE_BYTES` (512 KB) is now the single ceiling, shared by the upload
route, the client-side pre-check and the pass builder. The refusal happens at the
file picker, in the merchant's language, instead of never. Pinned by a test.

---

## 12. The brand's second colour

**Status: implemented.**

`secondaryColor` was offered in the Brand panel beside three colours that all
rendered. A merchant could set it, save it, and watch nothing happen — which is
worse than not offering it, because it makes the rest of the screen suspect.

It now drives the far stop of a `gradient` card:

```
gradient + brand secondary  →  linear-gradient(145deg, background 0%, secondary 100%)
gradient, no secondary      →  the derived three-stop gradient (previous behaviour)
```

Two deliberate limits:

- **Only `gradient` reads it.** `duotone` keeps using the *accent* as its second
  tone — it is a hard split rather than a blend, and the accent is the colour
  chosen to stand against the background.
- **Text must clear AA against *both* stops.** With a gradient the copy crosses
  two colours; checking only the background is how a card ends up readable at the
  top and invisible at the bottom. When the two brand colours are too far apart
  in luminance for any single text colour to clear both — a near-black paired
  with a cream — the background's own answer wins, because the background is what
  carries the balance. That fallback is documented and tested rather than
  arbitrary.

---

## 13. Related

- [`WALLET_PROXIMITY.md`](WALLET_PROXIMITY.md) — geofencing, campaigns, the rule engine
- [`INTERNATIONALIZATION.md`](INTERNATIONALIZATION.md) — how "never mix languages" is enforced
- [`STORE_EXPERIENCE.md`](STORE_EXPERIENCE.md) — the counter scanner and the loyalty transaction
- `db/migrations/000021_brand_kit_and_card_design.sql` — the schema and the consolidation it performed
