# Internationalization

The requirement: **the application never mixes Spanish and English on the same page.**

That cannot be a convention, because conventions are exactly what a growing UI breaks.
It has to be a mechanism, and the mechanism is the type system plus a test.

---

## 1. What was wrong before

The previous implementation had three defects, and only one of them was about
missing strings.

**The locale was read from `localStorage` inside a `useState` initialiser.** That cannot
work: the server renders in the default locale, the client re-renders in whatever was
stored, React reports a hydration mismatch — and, worst of all, *a Spanish user's first
paint was English*. That first paint is precisely the mixed-language failure, and no
amount of extracting strings would have fixed it.

**Only the landing page was translated.** The dictionary held ~60 keys; the dashboard was
entirely hardcoded English.

**Components assembled sentences from fragments.** `{locale === 'es' ? '…' : '…'}`
appeared inline, and the demo had `Café Gratis` hardcoded next to English labels — a
literal mixed-language component.

---

## 2. The design

```
lib/i18n/
  locales.ts                 locale list, cookie name, Accept-Language parsing
  dictionaries/en.ts         the reference dictionary + the derived types
  dictionaries/es.ts         typed as Dictionary — a missing key is a build error
  translate.ts               createTranslator, Intl formatters (pure, no React)
  index.tsx                  the React binding: I18nProvider, useI18n, useT
  server.ts                  getLocale / getTranslator for server components
```

### The locale arrives from the server

`app/layout.tsx` resolves it from a **cookie** (`passimo_locale`), sets `<html lang>`,
generates localised metadata, and passes it to `I18nProvider` as a prop. So the first
byte is already in the right language.

Resolution order: the cookie (an explicit choice always wins) → `Accept-Language` (a
first-time visitor should land in their own language, not ours) → the default.

Switching language writes the cookie and reloads. Slightly slower than a client-side
swap, and correct: `<html lang>` and the server-rendered metadata are set outside
React's tree, and a soft refresh leaves them stale — which screen readers and search
engines both notice.

The provider holds **no local state**. Mirroring the prop into `useState` needs an effect
to stay in step, and a `setState` inside an effect is a cascading render on every
navigation. Deriving it is simpler *and* strictly more correct: there is no window in
which the client's idea of the locale differs from the `<html lang>` the server sent.

### The type system enforces completeness

`en.ts` is the reference. `Dictionary` is derived from it with every leaf widened to
`string`:

```ts
type Translated<T> = { [K in keyof T]: T[K] extends string ? string : Translated<T[K]> }
export type Dictionary = Translated<typeof en>
```

Widening matters. Typing Spanish as `typeof en` would demand the *English words*, which
is nonsense; typing it as `Record<string, unknown>` would demand nothing, which is how a
key goes missing. `Dictionary` demands the same keys with translated values — so
`pnpm typecheck` is what enforces "no mixed languages".

`TranslationKey` is every dotted leaf path, so `t('wallet.rules.summary')` is checked and
`t('wallet.rules.sumary')` does not compile. Plural bases are unioned back in, because
`card.toGo_one`/`_other` are *called* as `card.toGo` with a `count`.

---

## 3. Usage

```tsx
'use client'
import { useI18n } from '@/lib/i18n'

const { t, locale, formatCurrency, formatNumber, formatDate, formatRelative } = useI18n()

t('common.save')                                  // "Save" / "Guardar"
t('common.upgradeToUse', { plan: 'Growth' })      // interpolation
t('common.days', { count: 3 })                    // plurals, via Intl.PluralRules
formatCurrency(19, { currency: 'USD' })           // "$19" / "19 $"
formatNumber(123456)                              // "123,456" / "123.456"
formatRelative(someIso)                           // "3 days ago" / "hace 3 días"
```

Server components:

```ts
import { getTranslator } from '@/lib/i18n/server'
const t = await getTranslator()
```

### Conventions

- Keys are dotted namespaces mirroring where the string appears.
- `{placeholders}`, interpolated by name. Numbers are localised on the way in.
- `key_one` / `key_other` for plurals, selected by `count`.
- **No sentence is assembled from fragments in a component.** Word order differs between
  languages: concatenation is how "3 puntos restantes" becomes "restantes 3 puntos".
- Formatting goes through the provider's helpers, never `Intl` directly. Currency
  placement, date order and thousands separators are all language facts.

---

## 4. What the tests catch that types cannot

`tests/unit/i18n.test.ts`:

| Test | The failure it prevents |
| --- | --- |
| Same key set in every locale | Belt and braces on the type check. |
| No blank values | A key present but empty renders as a blank label. |
| Identical placeholders across locales | A *translated* placeholder — `{precio}` for `{price}` — renders as empty, so a price silently disappears from the pricing page. |
| Both plural forms wherever either exists | A half-declared pair falls back to the raw key and prints `wallet.rules.matched_other` at a merchant. |
| **Spanish values differ from English** | A key added to English and pasted into Spanish untranslated — the exact mixed-language page the brief forbids, and invisible to the type system. |
| Locale detection and formatters | Regional Spanish resolving to Spanish; separators and currency placement. |

The "must differ" test has an explicit allow-list of values that are legitimately
identical — brand names (Passimo, Apple Wallet), loan words Spanish uses unchanged
(emoji, beacon, cookies, plan, legal, visible), symbols, and a street name used as a
placeholder. Each entry is deliberate. Anything not on the list and identical fails the
build.

### A real bug this found

`formatCurrency` used `Intl.NumberFormat` defaults. `en-GB` disambiguates a foreign
currency by prefixing the country, so USD rendered as **`US$5`** — the pricing page read
"From US$5/month" to every English visitor. Fixed with
`currencyDisplay: 'narrowSymbol'`.

---

## 5. Coverage

Every merchant-facing and customer-facing surface now renders from the dictionary.

A previous revision of this document claimed **100%** at a point when it was not
true, and the way it was wrong is worth keeping on the record, because it is the
same blind spot twice. The claim was made by looking at *screens* — and by that
measure it was nearly right. What it missed was everything that is not a screen:

- the **wallet card face**, which is the most permanent surface the product has;
- the **email shell**, which declared `lang="es"` on every message ever sent;
- **proximity push notifications**, whose merchant-unset fallbacks were English;
- the **public gift shop**, a real screen that owned no keys at all and so
  contributed nothing for a dictionary walk to notice;
- **partnership, gift-card-sale and service-recovery notifications**.

All are fixed, and the screen-coverage test now carries the non-screen surfaces
(`wallet.pass`, `wallet.push`, `emails`, `giftShop`) as named entries so the same
gap cannot reopen silently. The lesson is in §"What the screen-coverage test
adds": a dictionary test can only check keys that exist.

| Area | Screens |
| --- | --- |
| Public | Landing and every section, pricing, the interactive demo, login, signup, the customer card page, the join page, the gift card shop, the offline page, the legal documents |
| Dashboard shell | Navigation, workspace switcher, trial and reactivation banners, the notification bell, the language and theme toggles |
| Dashboard screens | Overview, customers (list, profile, CSV import), rewards, gift cards, memberships, campaigns, automations, growth, partner network, analytics, AI insights, locations, wallet & proximity, settings, plan & billing |
| Counter | The point of sale and every state of the scanner — camera, manual search, each of the seven scan outcomes, the offline queue and its failure notice |
| Onboarding | The three-step wizard and the first-steps checklist |
| Admin | The platform console |

### What this pass changed beyond adding strings

Three of the four remaining defects were categories rather than screens, which is why
the previous count of "14 screens" understated the work.

**Shared states were English everywhere at once.** `components/states.tsx` renders the
loading, empty and error state of every list in the dashboard. Because it was English, a
Spanish screen showed `Loading…` for the duration of every fetch and `Something went
wrong` on every failure — genuinely mixed-language, but only while a request was in
flight, so no screenshot ever caught it. Translating that one file fixed the transient
state of sixteen screens.

**Numbers and dates resolved to the browser's locale, not the product's.** `formatValue`
and the counter's `money()` passed `undefined` to `Intl`, which means "whatever this
device is set to". A Spanish merchant on an English laptop read `€1,234.50` inside an
otherwise Spanish page, and no amount of translating labels would have moved it. Both
now take the resolved locale explicitly; `useFormatValue()` is the bound version
components use.

**Relative time was assembled by hand.** `formatRelative` built `"3 days ago"` from a
number and a noun, which is unfixable by translation: Spanish puts the preposition first
(*hace 3 días*), so replacing "days" produces nonsense. It now goes through
`Intl.RelativeTimeFormat`, which also gives the *yesterday* / *ayer* special case for
free.

### The plan catalogue holds keys, not prose

`lib/billing/plans.ts` carried each tier's tagline and bullet list as English sentences,
and the pricing page rendered them directly — so the Spanish marketing site advertised in
English, on the page where the buying decision is made. A tier now carries `taglineKey`
and `highlightKeys`, and a unit test asserts they are keys rather than sentences.

The tier *names* stay literal. "Growth" is what appears on the invoice and in the Stripe
dashboard, and a merchant reading "Crecimiento" in the product would have to work out
that those are the same thing.

The same applies to `FEATURE_LABEL_KEYS` and `LIMIT_LABEL_KEYS`, which are what paywalls
and usage meters read.

### The API answers in one language; the browser translates it

A route handler has no view and no locale, so threading a translator through
`defineRoute` to produce a string only the browser will ever render would put
presentation inside the transport. The envelope therefore stays as it is —
`{ code, message, details }` — and `lib/client/api-errors.ts` maps `code` and the
structured `details` onto dictionary keys.

A paywall message is *rebuilt* from the feature, the limit and the numbers the server
enforced, rather than translated from prose, so the merchant reads the same facts in
their own language. The server's own sentence is the last fallback, for codes we have no
copy for — an untranslated sentence beats a blank toast, and it is the only remaining
place one can appear.

### Background output follows the merchant, not the request

A dunning email is sent by a webhook, an overage warning by somebody else's scan, a
renewal reminder by a cron job. None of them has a reader whose cookie could say what
language to use, and defaulting them to the platform's language means a Spanish café
gets an English invoice warning.

`lib/i18n/business.ts` resolves `businesses.locale` instead — the column Settings already
edits — and memoises it for a minute so a fan-out does not read the same row hundreds of
times. Every notification and transactional email the platform writes goes through it.

Which surfaces, concretely:

| Surface | Where the business locale is applied |
| --- | --- |
| Wallet card face — every label and date | `lib/wallet/pass-content.ts` → `buildPassLabels`, consumed by both providers |
| Proximity push fallbacks | `lib/wallet/proximity.ts` |
| Lock-screen relevance copy | `lib/wallet/pass-content.ts` → `toRelevantLocation` |
| Email shell — `lang`, unsubscribe, footer | `lib/messaging/email-layout.ts` |
| Gift card delivery and receipt | `lib/jobs/commerce-handlers.ts` |
| Membership renewal merge fields | `lib/jobs/commerce-handlers.ts` |
| Dunning, soft limits, billing webhooks | `lib/billing/*`, `app/api/v1/billing/webhook` |
| Partnership, gift-card-sale, service-recovery notices | `lib/growth/*`, `lib/commerce/gift-cards.ts` |
| Location CSV import errors | `lib/wallet/locations.ts` |
| Wallet campaign and rule templates | `lib/wallet/campaigns.ts`, `rule-store.ts` |

One exception, deliberately: a message addressed to a *customer* prefers
`customers.locale` and only falls back to the business's, because that customer
stated a preference when they enrolled. `lib/messaging/dispatch.ts` is the only
place that distinction applies.

### Money and dates in background output

`Intl` calls in background code carried `'en-GB'` literals, which is the same bug
wearing different clothes: a gift card email put English month names and
`en-GB`-ordered dates in front of a Spanish café's customers, and the
gift-card-sold notification printed `25.00` with no currency symbol at all.
Background formatting now derives its tag from the business locale, and amounts
carry the currency from the row.

`lib/i18n/translate.ts` and `lib/i18n/locales.ts` are in the enforced coverage floor
(`vitest.config.ts`).

### What the screen-coverage test adds

The dictionary tests walk the whole file, so they cannot notice a screen that was never
converted — a screen with no keys contributes no keys to walk. That is exactly how the
previous pass could report an i18n system "enforced by the compiler" while fourteen
screens rendered in English: every key in the file was perfect, and the English was in
the components.

`tests/unit/i18n.test.ts` now also asserts the *inventory*: every screen owns a
namespace, each namespace carries the copy a screen cannot render without (its title,
and its empty and error states), and each is translated leaf by leaf with failures
reported by screen name rather than by dotted key.

---

## 6. Adding a language

1. `lib/i18n/dictionaries/fr.ts`, exporting `const fr: Dictionary = { … }`. TypeScript
   will list every key you have not translated.
2. Add `'fr'` to `LOCALES` and the entries in `LOCALE_LABELS`, `LOCALE_SHORT` and
   `LOCALE_TAGS` in `locales.ts`.
3. Register it in `DICTIONARIES` in `translate.ts`.

Nothing else. The language switcher renders from the locale list, plural selection goes
through `Intl.PluralRules` (so a language with more than two forms needs no code
change), and the tests pick the new locale up automatically.
