# Merchant onboarding

The objective: a merchant who has just signed up reaches **"ready to scan the first
customer"** with the fewest decisions possible, without skipping anything the product
genuinely cannot operate without.

Two words in that sentence are doing the work. *Decisions*, not screens — a wizard with
one step and eleven fields is not simple. And *genuinely*, because everything a merchant
is asked before their first customer is a chance for them to close the tab.

---

## 1. The flow as it was

Audited before anything was changed. Signup wrote the business row; the wizard ran in
four steps at `/onboarding`.

| Step | Screen | What it asked for |
| --- | --- | --- |
| — | `/signup` | Business name, **trade**, email, password |
| 1 | Your business | **Trade (again)**, city |
| 2 | Your card | Colour palette, reward text, stamp goal |
| 3 | Your QR | Nothing — a QR code, a copy button, a download button |
| 4 | First customer | Enrol yourself as a test member, open the scanner, scan, finish |

**11 required interactions across 4 blocking screens**, counting each field, each choice
and each confirming tap. Three problems, in order of how much they cost:

**It re-asked for the trade.** Signup already collected `category`, and step 1 asked for
it again — with a *different* list of options. Nothing teaches a merchant faster that the
questions are not being read.

**It never mentioned money or place.** A merchant could complete every step and land on
the dashboard with no plan chosen and no location on file. That is the wrong pair of
omissions: the plan is the decision the business needs made, and a location is the
prerequisite for every proximity feature — a geofence needs a centre, so a merchant who
later opens "Wallet & proximity" finds every radius inert with no explanation.

**Its last step was a rehearsal.** Step 4 enrolled the merchant as a fake customer named
`You (test member)` so they had somebody to practise on, then asked them to scan
themselves. Well-intentioned — the daily workflow is the thing they most need to
learn — but it is a simulation standing between them and the real thing, and it wrote a
junk row into the customer list they had not yet seen.

---

## 2. The flow as it is

Defined in one place — `STEPS` in `app/onboarding/page.tsx` — so the stepper, the
skip control, the progress percentage and the resume logic cannot disagree about
what the flow is.

| Step | Screen | Required? | What it asks for | Why here |
| --- | --- | --- | --- | --- |
| — | `/signup` | — | Business name, trade, email, password | Creates the business. Already existed; unchanged. |
| 1 | `program` — your loyalty program | **Required** | Stamps or points, and what earns a reward | The one thing the product cannot operate without. Prefilled per trade from `lib/onboarding/presets.ts`. |
| 2 | `plan` | Optional | One choice, or "start my trial" | The only decision with money attached. Skippable so nobody is blocked; the trial is live either way. |
| 3 | `shop` | Optional | Shop name, address, city | A card points somewhere and a geofence needs a centre. Coordinates explicitly optional. |
| 4 | `card` | **Required** | Palette, reward wording, goal — with a live card preview | This is the product. Prefilled from the trade, so the merchant confirms rather than composes. |
| — | `ready` | — | Nothing — QR code, "scan my first customer" | Not a step. The output. |

Two of the four are optional, and that is marked in `STEPS` rather than implied
by the UI, so `optional` drives the skip link, the badge and the percentage from
one field.

### The reduction

| | Before | After |
| --- | --- | --- |
| Blocking screens | 4 | 2 (`program`, `card`) |
| Required interactions | 11 | 6 |
| Questions asked twice | 1 | 0 |
| Steps that write nothing real | 2 (the QR page, the rehearsal) | 0 |

The interaction count fell by nearly half, and — more importantly — only two
screens can actually stop a merchant. The flow now also covers *plan* and
*location*, neither of which it previously touched, while asking less overall.

### The card step is the real designer

`card` renders the same `CardPreview` and the same `resolveCardDesign` the
dashboard designer and the wallet pass builder use, seeded with the trade's
preset. A merchant watches their card change as they choose, and what they see is
what their customer installs — not a marketing approximation of it. See
[`BRAND_AND_CARD_DESIGN.md`](BRAND_AND_CARD_DESIGN.md).

---

## 2b. Resume

Progress is persisted **server-side** in `business_onboarding.last_step`, written
by `PATCH /api/v1/onboarding`. Because it is not in `localStorage`, it survives
refresh, logout, a new login, closing the browser and session expiry — the list
the brief asks for is satisfied by where the cursor lives rather than by handling
each case.

The stored step is a **hint, not an instruction**. `resumeStep` recomputes what is
genuinely outstanding from the account and uses the cursor only to avoid sending
someone back past work they had already done. Three rules earn their tests:

- **A live trial is not evidence of choosing a plan.** Every signup starts one, so
  treating it as "plan chosen" skipped the only screen showing prices.
- **A stale cursor never jumps a missing prerequisite.** Stored `card` with the
  location since deleted resumes at `shop`.
- **A cursor written by the previous wizard still works.** `location` was this
  step's name before it was renamed `shop`; those rows are in the database.

`hasConfiguredLocation` deliberately does not count the placeholder location
`passimo_provision_business` creates at signup. Treating that as an answer is what
previously made the location step unreachable for every merchant, so no geofence
had a centre and no pass carried a place.

Pinned by 30 tests in `tests/unit/onboarding-resume.test.ts`.

### Mapping to the four required steps

The mandate names four: create the business, choose a plan, configure the first location,
activate the default loyalty card. The first of those is satisfied by signup, which
already collects the name, trade, time zone and locale and provisions the business row —
so the wizard covers the remaining three. Re-asking inside the wizard for something
signup has is the exact defect that was removed.

---

## 3. What moved out, and where it went

Nothing was deleted. Everything the old flow demanded now lives in a **first-steps
checklist** on the dashboard: `components/onboarding/first-steps.tsx`, driven by
`lib/onboarding/checklist.ts`.

| Item | Links to | Shown when the plan includes |
| --- | --- | --- |
| Serve your first customer | `/pos` | always |
| Customise your Wallet card | `/dashboard/wallet/design` | always |
| Add your logo and brand colours | `/dashboard/wallet?tab=brand` | always |
| Add your other locations | `/dashboard/locations` | `multi_location` |
| Switch on proximity notifications | `/dashboard/wallet` | `geofencing` |
| Send your first campaign | `/dashboard/campaigns` | `campaigns` |
| Invite your team | `/dashboard/settings` | `team_management` |

The first two rows were one row until 2026-09-04, called *"Personalise the card"*
and pointing at `/dashboard/settings`. That was the only place in the entire
product where a merchant met the word *card* in a list of things to do, and it
sent them to a screen that does not contain the card designer. They are now two
rows, because the card face and the business identity are two questions, and the
first of them goes straight to the editor. See
[`BRAND_AND_CARD_DESIGN.md`](BRAND_AND_CARD_DESIGN.md) §2.

Four rules it follows:

**It never blocks.** No modal, no interstitial, no "finish setup to continue". It sits
above the metrics on the overview — which is where a day-one merchant has no metrics to
read anyway — and it is gone in one click.

**Completion is derived, never stored.** Each item asks a question about the account and
answers it from the data that step would have produced: a second location row, a
proximity setting, a recorded visit. A stored `completed` flag drifts the moment a
merchant archives the location they just added, and a checklist that disagrees with the
product is worse than no checklist. Only the *dismissal* is a row.

**Dismissal is a row, not `localStorage`.** `business_onboarding.checklist_dismissed_at`,
so hiding it on the laptop hides it on the phone at the counter too. That also makes it
merchant behaviour stored as data, which is the standing rule (architectural decision
13).

**It retires itself.** When every visible item is done the card disappears without being
dismissed. A checklist of ticks is clutter.

### Gated items are hidden, not padlocked

An item the plan does not include is dropped rather than shown locked. The sidebar
already sells locked features; a "first steps" list that opens with three things the
merchant cannot do reads as a bait-and-switch on day one. Progress is counted against
what is visible, so a Starter merchant sees "1 of 2", not "1 of 6".

---

## 4. Feature gating

The wizard goes through the same gates as the rest of the dashboard. There is no parallel
permission path, which matters because onboarding is exactly where a shortcut would be
tempting and invisible.

- The checklist calls `has(feature)` from the workspace context — the same function the
  sidebar uses to decide what to padlock.
- Creating the first location goes through `POST /api/v1/locations`, which calls
  `requireWithinLimit(businessId, 'locations')`. Starter's cap is one, so the first
  location always fits and the second one meets the paywall it should.
- Choosing a plan goes through `POST /api/v1/billing/checkout`, which is
  `billing:manage`-gated like the billing screen.
- The onboarding endpoint itself is `settings:read` / `settings:write`.

A deployment with no Stripe credentials says so plainly and continues on the trial,
rather than showing four buttons that would all fail.

---

## 5. Internationalization

The whole flow is one of the screens converted in the same pass — see
`docs/INTERNATIONALIZATION.md`. Two details are specific to onboarding:

**The suggested reward is a dictionary key, not a sentence.** `getSuggestedSetup()`
returns `rewardKey`, resolved by the merchant's translator before it is written. It is
prefilled into a field they then save to their program, so it becomes *customer-facing*
content — a Spanish café whose card reads "A free coffee" is the mixed-language failure
at its most expensive, because it lands on a customer's phone rather than on an admin
screen.

**The palettes are shared with Settings.** `CARD_PALETTES` is one list used by both
screens, so a merchant who picked "Espresso" during setup finds that same name when they
go back to change it.

---

## 6. Tests

| Test | What it protects |
| --- | --- |
| `tests/unit/onboarding-presets.test.ts` | Every trade resolves to a real dictionary entry — a missing key would write the literal string `onboarding.presets.gym` onto a customer's card. |
| `tests/unit/onboarding-checklist.test.ts` | Ordering, plan gating, derived completion, and that the card retires itself. |
| `tests/e2e/onboarding.spec.ts` | Signup → onboarding → first scan, with the locale pinned. |

The e2e spec pins the locale cookie explicitly, the same way `tests/e2e/public.spec.ts`
does: it asserts on *behaviour* — that the wizard has three steps, that the plan step can
be passed without paying, that the counter is reachable at the end — and coupling those
assertions to whichever language ships as the default would make them fail on a marketing
decision.

---

## 7. What is deliberately still missing

- **No "invite your team" in the wizard.** It is on the checklist. A merchant setting up
  alone at 11pm does not have their staff's email addresses to hand, and a field they
  cannot fill is a field that stops them.
- **No logo upload.** Same reason, and the card looks correct without one.
- **No coordinates.** An address is enough to start; proximity is a checklist item, and
  asking for a latitude before the first customer would be absurd.
- **No verification step.** A confirmation email is sent at signup and does not gate
  anything — a merchant who cannot scan until they find a confirmation email is a
  merchant who does not scan. What verification *does* gate is everything that needs a
  real address to be safe: outbound marketing from the account, billing notices and
  password recovery. See `docs/AUTHENTICATION.md`.
