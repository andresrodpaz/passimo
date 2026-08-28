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

## 2. Brand Kit

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

## 3. Card design

**Status: implemented.** Stored in `wallet_card_designs`, one row per business.
A **missing row is the default design**, not an error.

### The model

| Field | Values | Notes |
| --- | --- | --- |
| `template` | see §5 | A set of starting values, not a mode |
| `cardStyle` | `solid`, `gradient`, `duotone`, `frosted` | Surface treatment |
| `progressStyle` | `auto`, `bar`, `stamps`, `points`, `none` | See §4 |
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

## 4. Progress rendering

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

## 5. Templates

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

## 6. Previews

`components/wallet/card-preview.tsx`, with `components/wallet/platform-switch.tsx`
toggling between the two platform framings.

**The preview is not a mock.** It renders through `resolveCardDesign` — the same
function the pass builder calls — so what a merchant sees while dragging a colour
picker is what their customer gets.

It shows an Apple Wallet-style and a Google Wallet-style layout, a QR/barcode
representation, customer information, loyalty balance, rewards and branding.

**It is labelled as a preview and does not claim to be a real provider pass.**
That matters for a reason beyond honesty: without Apple and Google credentials
(§8) no real pass can be issued at all, and a preview implying otherwise would
misrepresent what the deployment can do.

Previews appear in three places, all sharing the component:

| Where | Purpose |
| --- | --- |
| `app/onboarding/page.tsx` | The card being built, live, during setup |
| `app/dashboard/wallet/page.tsx` | The designer |
| `components/landing/*` | The public customisation demo |

Before a business exists, `placeholderBrandKit(name)` supplies a neutral,
complete kit so the preview never renders half-resolved.

---

## 7. Localisation of the card face

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

## 8. What is not finished

| Item | Status |
| --- | --- |
| Issuing a real Apple `.pkpass` | **Credential-dependent.** The builder and its `pass.json` structure are complete and unit-tested; no Apple certificates exist on this deployment. `appleWalletConfigured()` reports false and the UI says so. |
| Issuing a real Google pass | **Credential-dependent.** Class and object builders are complete and unit-tested; no issuer account exists. |
| Logo upload | Implemented via `lib/brand/logo.ts` and `lib/storage/*` (`local` and `s3` drivers). The `s3` driver is untested against a real bucket. |
| Hero/strip image | **Partial.** `heroImageUrl` is stored, resolved, and consumed by both providers — Apple as `strip.png`, Google as `heroImage`. But there is no upload control in the designer *and no component renders it*, so a merchant can neither set it nor preview it. It is reachable only by writing the column directly. |
| `secondaryColor` | Editable in the Brand panel, stored, and read by `mapBrandKit` — but no surface renders it yet. |
| Per-location card variants | **Not implemented.** One design per business. |

---

## 9. Tests

| Suite | Covers |
| --- | --- |
| `tests/unit/wallet-card-design.test.ts` | Hex parsing, WCAG contrast, the AA guarantee across every background/foreground pairing, progress-style resolution and its boundary at 12, row mapping and enum fallback, Brand Kit mapping, handle normalisation, patch building, `resolveBrandPalette` agreeing with the card resolver |
| `tests/unit/wallet-pass-build.test.ts` | Apple `pass.json` and Google class/object structure, the location cap and `maxDistance`, locale-correct dates, and a guard asserting no English phrase appears on a Spanish pass |
| `tests/unit/email-shell.test.ts` | The email shell agreeing with the card on text colour, `lang`, translated footer, HTML escaping |
| `tests/unit/landing-demo.test.ts` | The demo state machine, and that all 24 trade/palette combinations resolve to a legible card |

Run: `pnpm test`.

---

## 10. Related

- [`WALLET_PROXIMITY.md`](WALLET_PROXIMITY.md) — geofencing, campaigns, the rule engine
- [`INTERNATIONALIZATION.md`](INTERNATIONALIZATION.md) — how "never mix languages" is enforced
- [`STORE_EXPERIENCE.md`](STORE_EXPERIENCE.md) — the counter scanner and the loyalty transaction
- `db/migrations/000021_brand_kit_and_card_design.sql` — the schema and the consolidation it performed
