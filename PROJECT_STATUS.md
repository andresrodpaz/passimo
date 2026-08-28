# Fidelio — Project Status

> ## ⚠️ Superseded — historical record, do not trust as current
>
> **Read [`PASSIMO_LAUNCH_STATUS.md`](PASSIMO_LAUNCH_STATUS.md) instead.**
>
> This document was written under the product's former name and stopped being
> maintained on 2026-08-10. It is kept because the milestone history is genuinely
> useful, but several of its statements are no longer true:
>
> - The product is now **Passimo**, not Fidelio.
> - It describes **Supabase auth** and `supabase/migrations/…` paths. There is no
>   Supabase dependency anywhere in the product any more, and migrations live in
>   `db/migrations/`.
> - Its "verification state" and completion percentages predate the
>   infrastructure migration, the onboarding rebuild and the current test suites.
>
> The line below claiming this file always reflects the true state of the
> repository is exactly what it no longer does. It is left in place rather than
> quietly edited, because that claim is the reason the warning is needed.

> Living document. Always reflects the true state of the repository.
> **Resuming work? Read this file first, then continue from "Next Recommended Milestone".**

- **Last updated:** 2026-08-10
- **Last completed milestone:** `prompt5.md` — the three launch blockers closed: internationalization finished to 100%, merchant onboarding cut from four blocking steps to three, and billing and wallet reliability hardened against real failure
- **Next recommended milestone:** Seeded integration tests against a real database, then the real-device matrix (iOS Safari 16, older Android WebView, iBeacon hardware). Both are confidence gaps rather than feature gaps, and they are now the largest ones.

### Verification state (all green as of this entry)

```
pnpm typecheck      clean
pnpm lint           clean (0 errors, 0 warnings)
pnpm test           410 passed (16 files)
pnpm test:coverage  88.03% stmts / 82.41% branches / 91.39% funcs / 89.18% lines — thresholds met
pnpm build          compiled successfully in 39.2s
```

**e2e was not executed on this machine.** `pnpm playwright test --list` enumerates
**110 tests across 4 specs** (up from 94/3), so every spec parses and registers — but
Chromium refuses to launch here (`Failed to register the window class`, "your computer
has run out of resources", and `taskkill` absent from PATH). Every spec fails identically
at browser launch, including ones that passed in previous sessions, so this is the
environment rather than the suite. The new `tests/e2e/onboarding.spec.ts` has **not** been
observed green and must be run in CI before this claim is treated as verified.

---

## Overall Progress Dashboard

| Area | Completion |
| --- | --- |
| **Overall Completion** | **90% launch-ready / 96% feature-complete** |
| Core Platform | 94% |
| Authentication & RBAC | 90% |
| CRM | 94% |
| Loyalty | 92% |
| **Wallet & Proximity** | **96%** |
| Store Locations & Geofencing | 95% |
| **Subscriptions & Feature Gating** | **97%** |
| **Merchant Dashboard** | **96%** |
| Store Experience (hardware-free scanner) | 96% |
| Offline Support | 90% |
| Landing Page & Marketing Site | 97% |
| Platform Administration | 91% |
| **Internationalization** | **100%** |
| Demo Environment | 95% |
| Analytics | 88% |
| Marketing | 85% |
| AI | 80% |
| Growth & Network | 86% |
| Commerce (gift cards, memberships) | 89% |
| **Billing** | **95%** |
| Integrations | 70% |
| Security | 91% |
| Performance | 84% |
| UX/UI | 93% |
| Mobile Experience | 90% |
| **Testing** | **84%** |
| Documentation | 96% |
| Legal & Compliance pages | 90% |
| **Merchant Onboarding** | **95%** |

Launch-readiness moved from 78% to 90% because the three named blockers are closed, not
because everything is finished. What still separates it from 100% is confidence rather
than capability: no test exercises a real database round trip, the camera and GPS paths
have never run on physical hardware, and the e2e suite could not be executed in this
session. Those are the next milestone.

### Repository size

64 API routes · 29 pages · 16 migrations · 108 `lib` modules · 25 feature components
· 16 unit test files (410 tests) · 4 e2e specs (110 tests) · ~66,000 lines across
`app`/`lib`/`components`

---

## `prompt3.md` Mandate — Compliance

Every mandatory requirement, and where it lives.

### Apple Wallet & Google Wallet proximity

| Requirement | State | Implementation |
| --- | --- | --- |
| Location-aware wallet passes | Done | `lib/wallet/pass-content.ts` → both providers |
| Nearby location suggestions | Done | `nearbyOffers()`, `components/wallet/customer-proximity.tsx` |
| Lock screen suggestions | Done | Apple `relevantText` + `locations[]`; Google object `locations[]` |
| Wallet notifications | Done | `lib/wallet/notifications.ts`; Apple re-issue+push, Google `addMessage` |
| Pass updates | Done | `lib/wallet/sync.ts`, APNs + Google PATCH of the *whole* object |
| Dynamic pass content | Done | Offers and rewards on the card back; `dynamic_pass_content` toggle |
| Beacon support (optional) | Modelled | Columns, UI and `pass.json` emission complete; untested on hardware |
| GPS geofencing | Done | `lib/wallet/geo.ts` + `lib/wallet/proximity.ts`, entry/exit/dwell with hysteresis |
| Merchant locations | Done | `/dashboard/locations`, full CRUD + CSV import + geocoding |
| Multiple store locations | Done | Unlimited (plan-capped), per-site geofence config |
| Nearby offers | Done | `nearbyOffers()` on the card page |
| Nearby rewards | Done | Reward-ready campaigns and the `notify_reward_available` action |
| Automatic pass relevance | Done | Nearest-first ordering within each vendor's 10-location cap |
| Architecture: wallet service abstraction | Done | `lib/wallet/service.ts`, providers injected |
| Apple Wallet provider | Done | `lib/wallet/providers/apple.ts` |
| Google Wallet provider | Done | `lib/wallet/providers/google.ts` |
| Geolocation service | Done | `lib/wallet/geocoding.ts` (degrades to manual entry) |
| Store location service | Done | `lib/wallet/locations.ts` |
| Pass update service | Done | `lib/wallet/sync.ts` |
| Notification service | Done | `lib/wallet/notifications.ts` |
| Wallet synchronisation service | Done | `lib/wallet/sync.ts` (per customer and per business) |
| Dependency injection / clean architecture | Done | `createWalletService({ providers })`; pure core, thin shells |
| Every env var created, `.env.example` populated | Done | `lib/env.ts` + `.env.example`, inline **and** file-path forms |
| No hardcoded secrets | Done | Nothing read at module scope; `MissingEnvError` → 503 |
| Works fully except credential activation | Done | `docs/WALLET_PROXIMITY.md` §8 lists exactly what does and does not |

### Merchant configuration

| Requirement | State | Where |
| --- | --- | --- |
| Add / edit / delete unlimited locations | Done | `/dashboard/locations` |
| Set primary location | Done | Partial unique index + `setPrimaryLocation()` |
| Import locations | Done | CSV, idempotent on `external_ref` |
| Configure opening hours | Done | `OpeningHoursEditor`, several ranges per day |
| Configure location visibility | Done | `is_visible`, distinct from archiving |
| Enable/disable geofencing | Done | Business master switch + per-location |
| Configure notification radius | Done | Relevance, notification and outer-ring radiuses |
| Multiple / per-location radiuses | Done | Nullable overrides resolved against defaults |
| Entry / exit / dwell triggers | Done | Per location, with a dwell threshold |
| All wallet suggestion toggles | Done | `/dashboard/wallet` → Settings (7 toggles) |
| Location-based campaigns (all 10 kinds) | Done | `proximity_campaigns.kind` + template presets |
| Campaign: dates, weekdays, times, locations, segments, tier, points, visits, custom rules | Done | Every one is a column; `eligibility` jsonb for growth |
| Notification personalisation (title, message, emoji, CTA, reward, images, colours, logo, expiry) | Done | Campaign editor, with **live preview** |
| Automation rules without coding | Done | `components/wallet/rule-builder.tsx` + `lib/wallet/rules.ts` |
| All six example rules | Done | Preset gallery; each expressible in the builder |
| Intuitive visual rule builder | Done | Dropdowns + generated plain-language sentence |
| Analytics for every proximity feature | Done | `lib/wallet/analytics.ts`; all ten metrics tracked |
| Default templates (10 industries) | Done | `lib/wallet/templates.ts` |
| Activate a whole strategy in a few clicks | Done | `POST /wallet/templates` — settings + campaigns + rules |
| No feature requires editing source | Done | Verified: every behaviour is a row |
| No feature requires changing env after deploy | Done | Env holds credentials and infrastructure only |

### Landing page, demo data, subscriptions

| Requirement | State | Notes |
| --- | --- | --- |
| Remove fake social proof | Done | Deleted 3 invented testimonials and "2,400+ businesses / 89K stamps / 156K customers" |
| Replace with truthful alternatives | Done | Early-access programme, "built for modern local businesses", segment list, "launching soon" |
| No unverifiable claim anywhere | Done | Comparison table marks the enterprise column honestly rather than strawmanning it |
| Fix internationalization completely | **Partial (72%)** | System rebuilt and enforced; public surfaces + wallet/locations/admin converted. Deep dashboard screens remain — see Remaining work #1 |
| No mixed-language page | Done | Locale resolved server-side; no page renders two languages |
| Premium hero, animated gradient, wallet preview, live card, dynamic QR, clear value prop, both CTAs | Done | `app/page.tsx` + `components/landing/*` |
| Interactive demo (points, stamps, rewards, tiers, Apple, Google, dashboard) | Done | `components/landing/product-demo.tsx` — four coupled panels |
| Merchant dashboard showcase | Done | Drawn browser frame, six capabilities |
| Features section with icons and animations | Done | Six cards |
| Comparison vs paper / generic apps / enterprise | Done | Honest table, scrolls in its own container |
| How it works, 3 steps | Done | |
| Pricing redesigned, free plan removed, starts at $5 | Done | `lib/billing/plans.ts` |
| Real subscription logic | Done | Stripe + entitlements + `lapsed` state |
| Meaningful feature limits per plan | Done | 8 limit keys × 4 tiers, monotonic (test-enforced) |
| Feature gating across the application | Done | `requireFeature` / `requireWithinLimit` / `has()` / `can()` |
| Dashboard adapts to plan | Done | Locked nav items, upgrade prompts, gated tabs |
| Demo data (businesses, customers, transactions, visits, points, rewards, campaigns, analytics, wallet passes, QR history, notifications) | Done | `scripts/seed-demo.ts` |
| One demo merchant per plan | Done | `starter@`/`growth@`/`pro@`/`business@demo.com` |
| Super admin account | Done | `admin@demo.com` → `/admin` |
| Admin: plans, businesses, impersonation, analytics, wallet, AI, subscriptions | Done | `/admin`, four tabs |
| UI quality: spacing, typography, animation, loading/empty states, microinteractions, mobile | Done | Reduced-motion honoured; every list has loading/empty/error states |

---

## Modules

### Wallet & Proximity
- **Description:** Location-aware passes for both vendors, merchant-configurable geofencing, proximity campaigns, a no-code rule engine, and a measured conversion funnel.
- **Status:** Completed — **95%**
- **Completed:**
  - `lib/wallet/geo.ts` — haversine, bounding boxes, transition classification with hysteresis, privacy coarsening. Pure, **100% covered**.
  - `lib/wallet/pass-content.ts` — one provider-agnostic description of the card. Both providers render from it, so Apple and Google can never disagree about a program.
  - `lib/wallet/service.ts` — injectable provider registry. The whole stack is exercisable with fakes and no credentials.
  - `lib/wallet/proximity.ts` — the engine. Kill switches → candidates → transition → persist → facts → guards → rules → campaign → send.
  - `lib/wallet/eligibility.ts` — campaign eligibility and frequency guards. Pure, returns *every* refusal reason.
  - `lib/wallet/rules.ts` — the IF/THEN engine, total and isomorphic, with `describeRule` generating the merchant-facing sentence.
  - Web geofencing on the customer card page, reaching the ~half of customers who never install a pass.
  - Notification deduplication via a cooldown-bucketed key on a unique index — enforces cooldowns with no lock and no cleanup job.
  - Ten industry templates; everything they create arrives paused.
  - Campaign preflight returning every blocker plus the literal `pass.json` and Google object.
  - **This session:** partial vendor failure is now a *state* rather than a log line. `sync()` reports per provider including failures, `wallet_sync_state` records which vendor is behind and why, and only that vendor is retried, with exponential backoff and a bound. A delivery that fails after claiming its dedupe key now releases the key and queues a retry — previously it held the slot for the whole cooldown window, so one transient APNs error silently cost the merchant every send in that window.
- **Remaining:** Beacon hardware verification. Dwell triggers depend on report frequency in a backgrounded browser (wallet-native relevance is unaffected).
- **Technical debt:** None known.
- **Priority:** Low (mandate satisfied)
- **Last updated:** 2026-08-10

### Store Locations & Geofencing
- **Status:** Completed — **95%**. Full CRUD, CSV import idempotent on `external_ref`, optional geocoding that degrades to manual coordinate entry, opening hours with split shifts, visibility distinct from archiving, per-site geofence overrides resolved against business defaults.
- **Remaining:** A map picker. Coordinates are typed or geocoded; dragging a pin would be better but needs a Maps JS key and is not on the critical path.
- **Priority:** Low
- **Last updated:** 2026-07-31

### Subscriptions & Feature Gating
- **Status:** Completed — **97%**. Free plan removed; Starter $5 / Growth $19 / Pro $49 / Business $99. `lapsed` modelled as a non-purchasable tier so the existing entitlement machinery gates it with no special cases. Legacy `free`/`enterprise` values mapped in both the migration and the resolver. This session: dunning — a declined card is now a sequence with four warnings rather than a silence followed by a workspace going quiet — and the plan catalogue's copy moved to dictionary keys, because the Spanish pricing page had been advertising in English.
- **Remaining:** Proration UI, still delegated to the Stripe portal, which handles it correctly.
- **Priority:** Low
- **Last updated:** 2026-08-10

### Landing Page & Marketing Site
- **Status:** Completed — **95%**. Every fabricated claim removed. Hero with a wallet card and the lock-screen notification it produces; a four-panel interactive demo sharing one state object; features; how-it-works; dashboard showcase; honest comparison table; generated pricing; final CTA.
- **Remaining:** Open-graph images.
- **Priority:** Low
- **Last updated:** 2026-07-31

### Internationalization
- **Status:** Completed — **100%**
- **Completed:** Every merchant-facing and customer-facing surface renders from the dictionary. This session converted the fourteen remaining dashboard screens *and* three defects that were categories rather than screens: the shared loading/empty/error states (English in one file, therefore English in the transient state of sixteen screens), number and currency formatting (which resolved to the *browser's* locale, so a Spanish merchant on an English laptop read `€1,234.50` inside a Spanish page), and relative time (assembled by hand, and unfixable by translation because Spanish puts the preposition first). The plan catalogue now holds dictionary keys rather than English prose — the Spanish pricing page was advertising in English. API errors are localised in the browser from `code` + `details`. Background output — dunning emails, overage warnings, renewal notices — resolves `businesses.locale`, because a webhook has no reader whose cookie could answer that question.
- **Remaining:** Nothing. Adding a third language is three edits (`docs/INTERNATIONALIZATION.md` §6).
- **Technical debt:** None known.
- **Priority:** Low (mandate satisfied)
- **Last updated:** 2026-08-10

### Merchant Onboarding
- **Status:** Completed — **95%**. Cut from four blocking steps and eleven required interactions to three steps and six. Signup already collects the trade; the old step 1 asked for it again with a *different* list of options. The wizard now covers plan → first location → activate the card, which are the three things the product cannot operate without, and which the old flow did not ask for at all: a merchant could finish it with no plan chosen and no location on file, leaving every proximity radius inert with no explanation. The old fourth step — enrol yourself as a fake customer called `You (test member)`, then scan yourself — is gone; it was a rehearsal standing between the merchant and the real thing, and it wrote a junk row into a customer list they had not yet seen. Everything dropped moved to a persistent, dismissible first-steps checklist on the dashboard, gated by the same `has()` the sidebar uses, with completion *derived* from the data each step would have produced rather than stored.
- **Remaining:** Team invitations and logo upload are checklist items rather than wizard steps, deliberately. A guided second session for a merchant who dismissed the checklist early.
- **Priority:** Low
- **Last updated:** 2026-08-10

### Platform Administration
- **Status:** Completed — **90%**. `/admin` outside the merchant shell, gated server-side by `requirePlatformAdmin`. Platform metrics, MRR from live subscriptions only, plan breakdown, deployment capabilities, business list with counts, plan changes and read-only impersonation — both requiring a reason and both written to the *merchant's* own audit log.
- **Remaining:** Ending an impersonation from inside the merchant shell (currently a call to `DELETE /admin/impersonate`). A UI banner while impersonating.
- **Priority:** Medium
- **Last updated:** 2026-07-31

### Demo Environment
- **Status:** Completed — **95%**. `pnpm seed:demo` via Node's built-in type stripping — no new dependency. Four merchants (one per plan, four trades), a platform admin, ~2,660 customers on a realistic visit distribution, ledger entries over 400 days, locations with real coordinates and trade-shaped opening hours, active campaigns and rules, a populated wallet funnel with attributed visits, pass registrations at realistic install rates, and skipped notifications with reasons.
- **Remaining:** Nothing material. Refuses to run outside development; idempotent; deterministic.
- **Priority:** Low
- **Last updated:** 2026-07-31

### Core Platform
- **Status:** Completed — **94%**. `defineRoute` with a fixed order of cross-cutting concerns; structured logger; `AppError` taxonomy; idempotency; job queue and handlers; signed outbound webhooks; GDPR pipeline. This session: `wallet.sync_retry` and `wallet.notification_retry` job types, and the in-process rate-limit cache extracted into `lib/rate-limit-cache.ts` with a proven ceiling — it was previously a module-private map whose growth could not be observed from outside, on the highest-volume endpoint in the product.
- **Remaining:** The rate limiter is still in-process. It is now *bounded and tested* rather than merely assumed, but multi-region still needs a Redis or Postgres backend.
- **Priority:** Medium
- **Last updated:** 2026-08-10

### Authentication & RBAC
- **Status:** Completed — **90%**. Supabase auth, actor resolution, `requireBusinessAccess`, granular permission matrix, RLS, middleware guard. This session: `locations:read/write` and `wallet:read/write` added as their own permissions — a shift manager who should be able to correct their own store's opening hours has no business changing the billing email, and one permission for both forces that choice. Platform admin is a separate authorisation axis, deliberately not a role.
- **Remaining:** Staff PIN mode for shared counter devices; 2FA.
- **Priority:** Medium
- **Last updated:** 2026-07-31

### Store Experience / Counter Scanner
- **Status:** Completed — **95%**. Layered decoding (native `BarcodeDetector` → jsQR → manual), continuous scanning, one-round-trip resolve-and-credit, torch, camera switching, haptics, dead-track restart. Unchanged this session.
- **Remaining:** Physical device matrix (iOS Safari 16, older Android WebView).
- **Priority:** Low
- **Last updated:** 2026-07-29

### Offline Support
- **Status:** Completed — **90%**. IndexedDB scan queue, identification cache, automatic drain, service worker, PWA. The offline page is now translated.
- **Remaining:** Background Sync API so a queue drains with the tab closed.
- **Priority:** Low
- **Last updated:** 2026-07-31

### CRM
- **Status:** Completed — **92%**. Single customer read layer, ranked counter lookup, full profile aggregation, notes, tags, CSV import, export, segment compiler, RFM/churn, counter roster.
- **Remaining:** Duplicate merge UI. i18n.
- **Priority:** Low
- **Last updated:** 2026-07-29

### Loyalty
- **Status:** Completed — **92%**. `recordEarn` backed by an atomic Postgres function; rule evaluation; DB-enforced redemption guards; tier progression; expiry. This session: earn/redeem/adjust now queue a wallet sync through `scheduleWalletSync` rather than a raw `wallet.push` enqueue, so both vendors are reached by one code path.
- **Remaining:** Nothing material.
- **Priority:** Low
- **Last updated:** 2026-07-31

### Merchant Dashboard
- **Status:** Completed — **96%**. All screens live against real APIs; workspace provider with entitlements and permissions; scanner reachable everywhere. This session: every remaining screen translated, the first-steps checklist on the overview, and the shared loading/empty/error states fixed — which were English in one file and therefore English in the transient state of every list in the product.
- **Remaining:** A persistent offline indicator outside the scanner. Duplicate-customer merge UI.
- **Priority:** Low
- **Last updated:** 2026-08-10

### Analytics
- **Status:** Completed — **88%**. Overview metrics, cohort/retention SQL, charts, scan telemetry. This session: the full proximity funnel with honest rates (null, not zero), attributed visit delay, per-campaign and per-location performance, and a delivery log that shows skips with reasons.
- **Remaining:** Counter-speed metrics (scans/hour, average serve time) are still not surfaced from the telemetry `POST /scan` already logs.
- **Priority:** Medium
- **Last updated:** 2026-07-31

### Marketing
- **Status:** Completed — **85%**. Campaigns, segments, automation engine, transactional and broadcast messaging, templates, unsubscribe, surveys. The wallet channel now reaches both vendors through the service instead of Apple only — which had silently dropped every Android member.
- **Remaining:** WhatsApp provider adapter.
- **Priority:** Medium
- **Last updated:** 2026-07-31

### AI · Growth & Network · Commerce · Integrations
- **Status:** Unchanged this session — 80% / 85% / 88% / 70%. See the 2026-07-29 entry in the session log.
- **Priority:** Medium
- **Last updated:** 2026-07-29

### Security
- **Status:** Completed — **90%**. RLS on every new tenant table; permission matrix extended; platform admin stored not inferred; impersonation recorded before it starts, expiring, read-only by construction, and visible to the merchant; customer position reports authenticated by signed card token so a caller can only ever report for themselves; revenue never accepted from a client; coordinates coarsened and replaced rather than appended.
- **Remaining:** Formal pen-test; 2FA.
- **Priority:** Medium
- **Last updated:** 2026-07-31

### Performance
- **Status:** Completed — **82%**. Bounding-box pre-filter before haversine; customer facts assembled once per position report and reused across every campaign and rule; segment membership resolved only for segments a campaign actually references; business-wide pass sync fanned out one job per customer and only for customers who installed a pass.
- **Remaining:** Distributed rate limiting; query-level load testing.
- **Priority:** Medium
- **Last updated:** 2026-07-31

### UX/UI
- **Status:** Completed — **92%**. This session: the landing page rebuilt around the product rather than around claims; the demo replaced with four coupled panels; a live wallet-card preview shared between the marketing site and the merchant's settings screen; the generated rule sentence; the campaign preflight; reduced-motion honoured for every decorative animation; tables that scroll in their own container rather than making the page scroll sideways.
- **Remaining:** Full dark-mode pass on the scanner overlay; empty-state illustrations.
- **Priority:** Low
- **Last updated:** 2026-07-31

### Testing
- **Status:** In Progress — **84%**. 410 unit tests across 16 files; 110 e2e tests across 4 specs. Coverage floor extended with the six modules whose failures are *silent* in production: dunning, webhook idempotency, per-vendor wallet sync state, the rate-limit cache, and the onboarding checklist and presets. 88.03% statements.
- **Remaining:** Seeded-data integration tests against a real database — still the largest confidence gap, and now the next milestone. Real-device camera and GPS matrix. Visual regression. e2e specs for locations, wallet settings and the admin console.
- **Technical debt:** e2e could not be executed in this session — Chromium fails to launch on the development machine, identically for pre-existing specs, so `tests/e2e/onboarding.spec.ts` has been listed and typechecked but not observed green. It must be run in CI. Camera and GPS still cannot be asserted anywhere; confidence rests on unit tests plus the manual steps in `docs/WALLET_PROXIMITY.md` §10.
- **Priority:** High
- **Last updated:** 2026-08-10

### Documentation
- **Status:** Completed — **96%**. This session: `docs/ONBOARDING.md` (the before/after audit, the measured reduction, and what moved to the checklist), `docs/INTERNATIONALIZATION.md` rewritten to 100% with the three category defects it found, and `docs/API.md` extended with the dunning sequence and the onboarding endpoint.
- **Remaining:** Merchant-facing help content. A launch playbook for support and incident handling — the billing-recovery half of that is now code rather than prose.
- **Priority:** Medium
- **Last updated:** 2026-08-10

### Launch Audit
- **Status:** Completed — **100%**. The repository has been audited against the launch-readiness objectives defined in `prompt4.md`, and the findings are recorded in `LAUNCH_AUDIT_REPORT.md`.
- **Current readiness score:** **78/100**.
- **Priority:** High
- **Last updated:** 2026-08-01

---

## Architectural Decisions

Decisions 1–10 are unchanged from the 2026-07-29 entry (one route contract; engines not
features; atomicity in Postgres; a single customer read layer; hardware independence;
server-owned scan classification; identify-and-credit in one request; ambiguity probed
not guessed; never cache authenticated customer data offline; counter feedback rule-based
not AI). Added this session:

11. **One description of the card, two renderers.** `buildPassContent()` produces a
    provider-agnostic `WalletPassContent`; Apple and Google both render from it. Adding a
    field lands on both platforms simultaneously. Letting each provider assemble its own
    view of loyalty state is how the two halves of a loyalty product drift until two
    customers standing next to each other are told different balances.

12. **Wallet providers are injected, not imported.** `createWalletService({ providers })`.
    The stack is therefore exercisable with fakes and no credentials — the state this
    repository ships in, and therefore the state that has to work — and an unconfigured
    provider is *absent* rather than failing.

13. **Merchant behaviour is data; the environment holds only credentials.** Every radius,
    trigger, schedule, audience and string a merchant can change is a row. Nothing about
    how the product behaves for a tenant requires a deploy or an environment change.

14. **Proximity guards fail closed.** A wallet pass is deleted the first time it feels like
    spam and there is no re-permission flow, so an unreadable frequency counter counts as
    maximum pressure. Losing one notification costs less than losing the card.

15. **Deduplication through a unique index, not a lock.** The notification dedupe key
    buckets by the campaign's own cooldown, so two crossings inside one window produce the
    same key and the second insert conflicts. Cooldowns are enforced as a side effect of
    the schema — correct across concurrent requests from several devices, with no cleanup
    job.

16. **Plan shape is code; plan assignment is data.** The catalogue lives in
    `lib/billing/plans.ts` and changes with a deploy. The admin console can *assign* a tier
    but not redefine one: that is the right blast radius for a decision affecting every
    merchant at once, and a runtime-editable catalogue would make entitlements
    unauditable.

17. **`lapsed` is a tier, not a boolean.** Modelling "trial expired, no card" as a
    non-purchasable plan with no features means the existing entitlement machinery gates it
    correctly with zero special cases — and reads keep working, because nothing is ever
    deleted.

18. **The i18n contract is enforced by the compiler, not by review.** Every locale is typed
    against the English dictionary, so a missing key fails `pnpm typecheck`. A test then
    catches what types cannot: a Spanish value left in English, a translated placeholder,
    a half-declared plural pair.

19. **A generated sentence, not a written one.** The rule builder renders `describeRule()`
    — the same function the API and the list use. What the merchant reads is generated from
    what will run, so the description cannot drift from the logic. That is what makes a
    no-code builder trustworthy rather than merely convenient.

20. **Analytics may not flatter itself.** A rate with no denominator renders `—`, never 0%.
    Revenue with no configured amounts renders "not measured", never $0. A visit counts as
    a conversion only when attributed to a notification within six hours. Skipped
    notifications are shown with their reasons, because a quiet week has to be
    diagnosable.

21. **Platform administration is a separate authorisation axis.** A platform admin is not a
    very powerful merchant. Membership is stored in `platform_admins`, never inferred from
    an email domain, and admin routes deliberately bypass `defineRoute` rather than adding
    an admin escape hatch to the tenant contract.

22. **A declined card is a sequence, not an event.** Stripe owns the retries; we own the
    conversation. Every stage warns *before* anything changes, states plainly that nothing
    has been deleted, and advances on Stripe's `attempt_count` rather than on our clock —
    so our story and their schedule cannot drift. Three independent guards stop a merchant
    hearing about one attempt twice: the event-id claim, the unique key on the dunning row,
    and a stage comparison. Recovery is a message too; silence after three warnings reads
    as "still broken".

23. **Two wallets fail independently, so they are recorded independently.** Collapsing an
    Apple success and a Google failure into two integers loses the only fact worth keeping —
    *which* vendor is stale. A partial failure is neither an exception (that would fail a
    check-in at the counter for a background push) nor a success (that would leave a
    customer looking at a wrong balance for weeks). It is a state, with a bounded retry
    against exactly the half that failed.

24. **Claiming a slot must be reversible.** The notification dedupe key is taken *before*
    delivery, which is what makes concurrent geofence crossings collapse into one send. It
    also meant a failed delivery held the slot for the whole cooldown window. The column is
    now nullable, a failure releases the claim, and the row survives for the delivery log —
    Postgres treats nulls as distinct, so the cooldown still works and the window is no
    longer spent on a corpse.

25. **Copy that a merchant reads is a key, wherever it lives.** Plan taglines, feature
    labels, limit names and suggested rewards were English string literals in `lib/`, which
    meant a fully translated UI still advertised in English on the pricing page and wrote
    English onto a Spanish customer's loyalty card. Anything a person reads is a dictionary
    key, including in modules that have nothing else to do with presentation.

26. **Background output resolves the merchant's locale, not the request's.** A webhook, a
    cron job and somebody else's scan all produce merchant-facing text with no reader whose
    cookie could answer "which language?". They read `businesses.locale` instead. The
    request-scoped translator is for requests; assuming it everywhere is how a Spanish café
    gets an English invoice warning.

---

## Remaining work, in priority order

Items 1, 5 and the i18n gap from the previous list are **done** and removed. Entry 3 is
debt discovered while doing them.

1. **Seeded integration tests** (High for confidence) — no test exercises a real database
   round trip with seeded data. Now the largest gap and the next milestone: every failure
   path added this session is unit-tested against its pure core, and the shells around
   them (`dunning-store`, `wallet/sync`, the onboarding endpoint) are covered only by
   reading the schema.
2. **Run the e2e suite** (High for confidence) — 110 tests across 4 specs list correctly
   but could not be executed in this session; Chromium fails to launch on the development
   machine, identically for pre-existing specs. `tests/e2e/onboarding.spec.ts` has never
   been observed green.
3. **The dunning sequence has never met a real Stripe** (High for confidence, **new**) —
   the transitions are unit-tested and the webhook is wired, but no live
   `invoice.payment_failed` has driven it. Worth exercising against a Stripe test-mode
   subscription with a card that declines on renewal before the first paying customer.
4. **e2e coverage of the remaining screens** (Medium) — locations, wallet settings,
   campaign editor, rule builder, admin console.
5. **Real-device matrix** (Medium) — iOS Safari 16, older Android WebView, iBeacon
   hardware.
6. **Distributed rate limiting** (Medium) — the in-process cache is now bounded and
   tested, but multi-region still needs a Redis or Postgres backend.
7. **Counter-speed analytics** (Medium) — still unsurfaced from telemetry `POST /scan`
   already logs. Carried over twice now.
8. **WhatsApp provider adapter** (Medium) — the channel is modelled end to end.
9. **Named POS adapters** (Medium) — Square and Lightspeed on the generic ingest.
10. **Impersonation banner** (Medium) — visible indicator inside the merchant shell.
11. **Staff PIN mode** (Medium) — shared counter devices share one login.
12. **Background Sync API** (Low) — drain the offline queue with the tab closed.

---

## Session Log

### 2026-08-10 — Session 5 (`prompt5.md`: i18n to 100%, onboarding, billing & wallet reliability)

**Summary.** Closed the three blockers the launch audit named. The i18n work was larger
than "14 screens" implied — three of the four remaining defects were *categories* rather
than screens, and each was invisible to the dictionary tests because the English was in
components, not in the dictionary. Onboarding lost a step and nearly half its required
interactions while *gaining* the two things it had never asked for. Billing and wallet
grew the failure paths they had been missing: a declined card is now a warned sequence
rather than a silence, and a wallet vendor that fails is recorded, retried and visible
instead of logged and forgotten.

**Features implemented**

- **Internationalization, finished.** Every remaining screen converted — overview,
  customers (list, profile, CSV import), rewards, gift cards, memberships, campaigns,
  automations, growth, network, analytics, insights, settings, billing, onboarding and
  the counter scanner in all seven of its scan outcomes. Beyond the screens:
  `components/states.tsx` (the loading, empty and error state of every list in the
  product), `components/metrics.tsx`, the notification bell, the plan catalogue, and the
  API error envelope.
- **`lib/client/api-errors.ts`.** The API answers in one language because a handler has no
  view; the browser renders it in the merchant's. Maps `error.code` and the structured
  `details` onto dictionary keys, and *rebuilds* paywall copy from the feature, limit and
  numbers the server enforced rather than translating prose.
- **`lib/i18n/business.ts`.** Merchant-facing text produced with no request behind it —
  dunning emails, overage warnings, renewal notices — resolves `businesses.locale`,
  memoised for a minute.
- **Onboarding, three steps.** Plan → first location → activate the card. Signup already
  had the trade; the old step 1 asked for it again with a different option list. The QR
  screen became the *output* rather than a step, and the "enrol yourself as a test
  customer and scan yourself" rehearsal is gone.
- **First-steps checklist.** `lib/onboarding/checklist.ts` (pure, tested) plus
  `components/onboarding/first-steps.tsx`. Persistent, dismissible, plan-gated through the
  same `has()` the sidebar uses, and it retires itself when everything visible is done.
  Reuses the existing card, meter and button primitives — no second notification system.
- **Dunning.** `lib/billing/dunning.ts` (the pure sequence) and
  `lib/billing/dunning-store.ts` (persistence and delivery, through the existing
  transactional email path). Four stages, each warning before anything changes, driven by
  Stripe's `attempt_count` and its `next_payment_attempt`; recovery closes the sequence
  and says so.
- **Per-vendor wallet sync state.** `lib/wallet/sync-state.ts` (pure) plus
  `wallet_sync_state`. `walletService.sync()` now reports failures and accepts a provider
  filter, so a retry re-pushes only the half that failed.
- **Notification retry.** `wallet.notification_retry`, bounded at three attempts.

**Bugs found and fixed**

- **The proximity frequency guard did not fail closed on an unreadable counter.** The
  mandate asked us to confirm decision 14 held "under a network or counter read error"
  rather than assume it — it did not. `notificationPressure()` returns
  `MAX_SAFE_INTEGER` when its read *throws*, but a malformed row or a failed numeric
  parse produces `NaN`, and every comparison against `NaN` is false: the guard fell
  straight through to `allowed: true`. A database blip was permission to ignore the
  merchant's daily cap — the one failure this subsystem cannot afford, because a deleted
  wallet pass has no re-permission flow. Both counters are now checked for readability
  before they are compared, and `null` (never notified) is kept distinct from `NaN`
  (could not tell).
- **A failed notification held its dedupe key for the whole cooldown window.** The key is
  claimed before delivery — deliberately, since that is what collapses duplicate geofence
  crossings — so a delivery that failed afterwards left a corpse holding the slot. Every
  subsequent crossing in that window conflicted and was dropped as a duplicate. One
  transient APNs error therefore cost the merchant every send in the window, silently, and
  the delivery log showed a `failed` row nothing would ever revisit.
- **A wallet vendor failing while the other succeeded was a log line and nothing else.** A
  customer whose Google pass failed to update kept a stale balance until something
  unrelated triggered another sync. Neither the merchant nor we could see it.
- **The cancellation notice named a plan that no longer exists.** `customer.subscription.
  deleted` told merchants "You are on the Free plan" — wrong since the free tier was
  removed in Session 4, and read during a cancellation, which is the worst possible moment
  for the product to say something untrue about itself.
- **The Spanish pricing page advertised in English.** `lib/billing/plans.ts` held taglines
  and highlights as English sentences and the pricing table rendered them directly. The
  fully-translated marketing site was selling in the wrong language on the page where the
  decision is made.
- **Money and dates followed the browser, not the product.** `formatValue` and the
  counter's `money()` passed `undefined` to `Intl`, so a Spanish merchant on an English
  laptop read `€1,234.50` inside an otherwise Spanish page.
- **Relative time could not be translated at all.** `formatRelative` assembled "3 days
  ago" from a number and a noun; Spanish puts the preposition first (*hace 3 días*), so
  replacing the noun produces nonsense. Replaced with `Intl.RelativeTimeFormat`.
- **The e2e signup specs had drifted.** They queried `Your email` and a
  `create my program` button; the dictionary says `Email` and `Create my account`. They
  had been failing since Session 4 and nobody noticed, because e2e is not part of
  `pnpm test`.

**Security / hardening**

- Three new tenant tables — `business_onboarding`, `billing_dunning`, `wallet_sync_state`
  — all with RLS read and write policies, following migration 15.
- No new environment variables and no new module-scope secret reads; dunning uses the
  existing Resend path through `lib/env.ts`.
- Onboarding writes go through `requireWithinLimit` and the same permission matrix as the
  rest of the dashboard. There is no parallel permission path, which matters because
  onboarding is exactly where a shortcut would be tempting and invisible.
- Webhook idempotency extracted into `lib/billing/webhook-idempotency.ts` and tested in
  both directions: a duplicate must answer 200 (or Stripe retries forever against a row
  that will always be there) and a storage failure must answer 500 (or a paid upgrade is
  silently lost).
- The in-process rate-limit cache now has a proven ceiling and drops expired windows on
  read as well as on sweep.

**Migrations:** `000016_launch_hardening.sql` — `business_onboarding`, `billing_dunning`,
`wallet_sync_state`, `wallet_notifications.dedupe_key` made nullable (so a failed claim
can be released) plus an `attempts` column, and RLS on all three new tables.

**Dependencies:** none added. Dunning reuses `lib/messaging/transactional.ts`; the
checklist reuses the existing card, meter and button primitives; retries reuse the job
queue.

**Tests:** +68 (342 → 410), across 4 new files. `billing-dunning` (19): every transition,
replay and out-of-order delivery, plus the two schema constraints the idempotency story
rests on. `wallet-reliability` (27): partial vendor failure, backoff, abandonment, the
fail-closed guards, and the rate-limit cache under proximity volume.
`onboarding-checklist` (12) and a rewritten `onboarding-presets` (6). `i18n` gained
screen-coverage assertions — the dictionary tests could never notice a screen that was
never converted, because a screen with no keys contributes no keys to walk, which is
exactly how the previous pass reported an enforced system while fourteen screens rendered
in English. Coverage floor extended to six new modules; 88.03% statements (from 87.34%).

**Docs:** new `docs/ONBOARDING.md` (the before/after audit with the measured reduction);
`docs/INTERNATIONALIZATION.md` rewritten to 100% with the three category defects;
`docs/API.md` extended with the dunning sequence and the onboarding endpoint.

**Files added (14).** `lib/i18n/business.ts`, `lib/client/api-errors.ts`,
`lib/billing/{dunning,dunning-store,webhook-idempotency}.ts`,
`lib/wallet/sync-state.ts`, `lib/rate-limit-cache.ts`, `lib/onboarding/checklist.ts`,
`components/onboarding/first-steps.tsx`, `app/api/v1/onboarding/route.ts`,
`supabase/migrations/000016_launch_hardening.sql`,
`tests/unit/{billing-dunning,wallet-reliability,onboarding-checklist}.test.ts`,
`tests/e2e/onboarding.spec.ts`, `docs/ONBOARDING.md`

**Files modified (37).** `lib/i18n/dictionaries/{en,es}.ts` (roughly 700 new keys each),
`lib/billing/{plans,soft-limit}.ts`, `lib/wallet/{service,sync,notifications,eligibility}.ts`,
`lib/{rate-limit,onboarding/presets}.ts`, `lib/jobs/{queue,handlers}.ts`,
`lib/client/hooks.ts`, `components/{states,metrics,notification-bell}.tsx`,
`components/billing/upgrade.tsx`, `components/landing/pricing-table.tsx`,
`components/scanner/counter-scanner.tsx`, `app/onboarding/page.tsx`, `app/pos/page.tsx`,
`app/admin/page.tsx`, `app/dashboard/page.tsx`,
`app/dashboard/{customers,customers/[id],customers/import,rewards,gift-cards,memberships,campaigns,automations,growth,network,analytics,insights,settings,billing}/page.tsx`,
`app/api/v1/billing/{route,webhook}/route.ts`, `app/api/v1/admin/overview/route.ts`,
`vitest.config.ts`, `tests/unit/{billing,i18n,onboarding-presets}.test.ts`,
`tests/e2e/public.spec.ts`, `docs/{API,INTERNATIONALIZATION}.md`

**Overall completion: 78% → 90% launch-ready / 93% → 96% feature-complete**

### 2026-07-31 — Session 4 (`prompt3.md`: wallet proximity, paid plans, landing, admin, demo, i18n)

**Summary.** Implemented `prompt3.md` end to end. The largest piece is wallet proximity —
a complete architecture from pure geo primitives through an injectable provider registry
to a merchant-configurable geofencing engine with measured conversion. Alongside it: the
free plan removed and the subscription system rebuilt around four paid tiers, a landing
page rewritten to remove every fabricated claim, a platform admin console, a demo
environment, and the internationalization system rebuilt so that "never mix languages" is
enforced by the compiler rather than intended by convention.

**Features implemented**

- **Wallet proximity (new subsystem, 17 modules).** `geo` (pure, 100% covered),
  `types`, `pass-content` (one description, two renderers), `service` (injected
  providers), `providers/apple`, `providers/google`, `locations`, `settings`,
  `eligibility` (pure), `rules` (pure, isomorphic), `rule-store`, `campaigns`,
  `proximity` (the engine), `notifications`, `events`, `analytics`, `sync`,
  `geocoding`, `templates` (ten industries).
- **Merchant configuration UI.** `/dashboard/locations` (CRUD, CSV import, geocoding,
  opening hours, per-site geofences) and `/dashboard/wallet` (settings with live card and
  lock-screen preview, campaigns with a preflight, the visual rule builder, the proximity
  funnel, the template gallery).
- **Customer-side proximity.** Web geofencing on the card page, reaching the ~half of
  customers who never install a pass, with consent copy shown *before* the browser prompt.
- **Subscriptions.** Free plan removed; Starter $5 / Growth $19 / Pro $49 / Business $99.
  `lapsed` introduced as a non-purchasable tier. Legacy `free`/`enterprise` mapped in both
  the migration and the resolver. Two new limit keys.
- **Landing page.** Rewritten. Hero with the wallet card and the lock-screen notification
  it produces; four-panel interactive demo sharing one state object; features; how it
  works; dashboard showcase; honest comparison table; generated pricing; final CTA.
- **Platform admin console.** `/admin` with metrics, MRR, plan breakdown, deployment
  capabilities, business list, plan changes and read-only impersonation.
- **Internationalization.** Rebuilt: server-resolved cookie locale, typed dictionaries,
  `Intl` plurals and formatters, localised metadata, a language menu.
- **Demo environment.** `pnpm seed:demo` — four merchants, a platform admin, ~2,660
  customers, a populated wallet funnel.
- **Legal pages.** `/legal/privacy`, `/legal/terms`, `/legal/cookies` — server-rendered
  in both languages, written from what the code actually does rather than from a
  template, with the disclaimer at the top rather than buried. The footer linked to
  these and they returned 404, which on a page whose whole argument is that we do not
  fabricate anything was the most expensive broken link on the site.

**Bugs fixed**

- **`coarsen()` was not idempotent.** The longitude step was derived from the *raw*
  latitude, so two readings metres apart produced different stored coordinates and
  re-coarsening a stored value returned something different again — a stationary phone
  appeared to drift. Now derived from the rounded latitude. Found by a unit test.
- **`formatCurrency` rendered USD as `US$5` in English.** `en-GB` disambiguates a foreign
  currency by prefixing the country, so the pricing page read "From US$5/month" to every
  English visitor. Fixed with `currencyDisplay: 'narrowSymbol'`. Found by a unit test.
- **The wallet messaging channel only ever reached Apple**, silently dropping every
  Android member. Now routed through the wallet service, and a customer with no pass
  installed is reported as a *permanent* failure rather than retried forever.
- **Google Wallet sync patched only the balance**, so a location a merchant added this
  morning never reached an installed pass. Now patches the whole object.
- **The i18n provider caused a hydration mismatch and an English first paint** for Spanish
  users, by reading `localStorage` in a `useState` initialiser. Now server-resolved.
- **`updateLocationSchema` / `updateCampaignSchema` erased their own field types** by
  building the shape with `Object.fromEntries`, so route handlers received `any`. Rebuilt
  with `.partial()`.
- **The e2e suite asserted English on pages that now default to Spanish** — a regression
  from translating login and signup. The specs now pin the locale cookie explicitly:
  they test behaviour, and coupling them to whichever language ships as the default would
  make them fail on a marketing decision.

**Security / hardening**

- New tenant tables all carry RLS read and write policies.
- `platform_admins` has RLS enabled and **no policy** — reachable only through the service
  role, because a platform admin reading it with their own JWT would be a
  privilege-escalation surface for no product benefit.
- Impersonation: recorded before it starts with a mandatory reason, expires in an hour
  checked against the clock rather than trusted from the cookie, read-only by
  construction, and written to the *merchant's* audit log.
- Customer position reports authenticate by signed card token, so a caller can only report
  for themselves; there is no parameter that would let them report for anyone else.
- Revenue is never accepted from a client.
- Coordinates coarsened to ~100 m and replaced rather than appended.
- `locations:*` and `wallet:*` split out as their own permissions.
- `/admin` added to the middleware's protected prefixes.

**Migrations:** `000015_wallet_proximity_and_paid_plans.sql` — plan remap, platform
admins, impersonation audit, extended `locations`, `wallet_settings`,
`proximity_campaigns`, `proximity_campaign_locations`, `proximity_rules`,
`wallet_events`, `wallet_notifications`, `customer_device_positions`, four RPCs, RLS.

**Dependencies:** none added. The seed script runs on Node's built-in type stripping.

**Tests:** +147 (195 → 342). New files: `wallet-geo` (35), `wallet-eligibility` (39),
`wallet-rules` (45), `i18n` (28). `billing` rewritten for the new catalogue. Coverage floor
extended to five new modules; 87.34% statements overall.

**Docs:** new `docs/WALLET_PROXIMITY.md`, `docs/SUBSCRIPTIONS.md`,
`docs/INTERNATIONALIZATION.md`, `docs/DEMO_ENVIRONMENT.md`; `docs/API.md` extended with
locations, wallet, public proximity and admin; README and `.env.example` rewritten.

**Files added (51).** `lib/wallet/{geo,types,eligibility,rules,rule-store,templates,settings,locations,geocoding,pass-content,service,campaigns,proximity,notifications,events,analytics,sync}.ts`,
`lib/wallet/providers/{apple,google}.ts`, `lib/api/wallet-schemas.ts`,
`lib/auth/platform-admin.ts`, `lib/admin/platform.ts`,
`lib/i18n/{locales,translate,index,server}.ts`, `lib/i18n/dictionaries/{en,es}.ts`,
`app/api/v1/locations/{route,import/route,geocode/route}.ts`,
`app/api/v1/wallet/{settings,campaigns,rules,templates,analytics,preview}/route.ts`,
`app/api/v1/public/proximity/route.ts`,
`app/api/v1/admin/{overview,businesses,impersonate}/route.ts`,
`app/dashboard/{locations,wallet}/page.tsx`, `app/admin/page.tsx`,
`components/landing/{wallet-card-preview,product-demo,pricing-table}.tsx`,
`components/wallet/{location-form,opening-hours-editor,rule-builder,campaigns-panel,rules-panel,analytics-panel,customer-proximity}.tsx`,
`scripts/{seed-demo.ts,package.json}`,
`supabase/migrations/000015_wallet_proximity_and_paid_plans.sql`,
`tests/unit/{wallet-geo,wallet-eligibility,wallet-rules,i18n}.test.ts`,
`docs/{WALLET_PROXIMITY,SUBSCRIPTIONS,INTERNATIONALIZATION,DEMO_ENVIRONMENT}.md`,
`lib/legal/documents.ts`, `app/legal/[document]/page.tsx`

**Files removed (2):** `lib/i18n.tsx`, `components/interactive-demo.tsx` (both replaced).

**Files modified (27):** `lib/billing/{plans,entitlements}.ts`, `lib/env.ts`,
`lib/auth/rbac.ts`, `lib/rate-limit.ts`, `lib/loyalty/engine.ts`,
`lib/messaging/providers.ts`, `lib/jobs/{queue,handlers}.ts`, `lib/client/api.ts`,
`lib/wallet/{apple-pass,apple-push,google-loyalty-jwt,google-sync,trigger-generate}.ts`,
`app/layout.tsx`, `app/page.tsx`, `app/dashboard/layout.tsx`,
`app/{login,signup,offline}/page.tsx`, `app/card/[token]/page.tsx`,
`app/api/v1/wallet/{apple,google}/[token]/route.ts`,
`app/api/v1/billing/{checkout,webhook}/route.ts`, `app/api/v1/customers/[id]/route.ts`,
`components/{language-toggle,billing/upgrade}.tsx`, `app/globals.css`, `middleware.ts`,
`vitest.config.ts`, `package.json`, `.env.example`, `README.md`, `docs/API.md`,
`tests/e2e/public.spec.ts`

**Overall completion: 88% → 93%**

### Earlier sessions

- **Session 4 (2026-07-31):** `prompt3.md` — wallet proximity, paid plans, landing page,
  admin console, demo environment, i18n rebuild. Migration 15. 88% → 93%. Full entry
  above.
- **Session 3 (2026-07-29):** Store Experience mandate — universal counter scanner,
  one-round-trip scan engine, offline queue, PWA, 10-minute-rule onboarding. Migration 14.
  72% → 88%.
- **Session 2:** Founder-mode expansion — commerce, growth, network, notification centre,
  a real POS flow. Migrations 12–13.
- **Session 1:** Platform foundation — schema (migrations 1–11), route contract, auth/RBAC,
  loyalty engine, CRM, wallet passes, marketing, analytics, dashboard, billing, AI, docs.
