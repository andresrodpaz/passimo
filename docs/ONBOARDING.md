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

| Step | Screen | What it asks for | Why it cannot wait |
| --- | --- | --- | --- |
| — | `/signup` | Business name, trade, email, password | Creates the business. Already existed; unchanged. |
| 1 | Your plan | One choice, or "start my trial" | The only decision with money attached. Offered once, with the trial as the default so nobody is blocked by it. |
| 2 | Your shop | Shop name, address, city | A card has to point somewhere and a geofence needs a centre. Coordinates are explicitly optional. |
| 3 | Your card | Palette, reward, stamp goal | This is the product. Prefilled from the trade signup already knows, so the merchant confirms rather than composes. |
| — | Ready | Nothing — QR code, "scan my first customer" | Not a step. The output. |

**6 required interactions across 3 blocking screens.**

### The reduction

| | Before | After |
| --- | --- | --- |
| Blocking screens | 4 | 3 |
| Required interactions | 11 | 6 |
| Questions asked twice | 1 | 0 |
| Steps that write nothing real | 2 (the QR page, the rehearsal) | 0 |

The step count fell by one; the interaction count fell by nearly half. The larger change
is which steps they are: the flow now covers *plan* and *location*, neither of which it
previously touched, while asking less overall.

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
| Personalise the card | `/dashboard/settings` | always |
| Add your other locations | `/dashboard/locations` | `multi_location` |
| Switch on proximity notifications | `/dashboard/wallet` | `geofencing` |
| Send your first campaign | `/dashboard/campaigns` | `campaigns` |
| Invite your team | `/dashboard/settings` | `team_management` |

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
