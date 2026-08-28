# The product

Passimo is a customer loyalty and retention platform for physical businesses — a
café, a barber, a gym, a bakery. The merchant runs it from a phone or a laptop;
the customer never installs anything.

Status labels used here: *implemented*, *partial*, *planned*,
*credential-dependent*. Anything unlabelled is implemented and running.

---

## 1. What it is for

A local business already has regulars. What it does not have is any record of who
they are, how often they come, or which of them stopped coming. Passimo turns the
visit — the thing that already happens at the counter — into that record, and
then uses it to bring people back.

**Positioning.** *Turn every visit into a relationship.* In Spanish, *Haz que tus
clientes vuelvan.* Both are in the dictionaries under `landing.hero`; neither is
a translation of the other, because the Spanish line that works is not the one a
translator would produce from the English.

The name comes from the digital *pass* that lives in Apple Wallet and Google
Wallet. That is worth knowing once, here, and never explaining to a merchant —
the product sells what it does, not what it is called.

---

## 2. The loop the whole product serves

Everything below exists to close this loop. A feature that does not feed it is a
feature that should not ship.

```
customer joins  →  card lands in their wallet  →  they visit
      ↑                                              ↓
 they come back  ←  message or pass notification  ←  scan at the counter
```

1. **Join.** The customer scans a QR code at the counter and opens
   `/join/[businessSlug]`. Email, optionally a name and birthday, consent. No app,
   no account, no password.
2. **Card.** They add the pass to Apple or Google Wallet, or keep the browser card
   at `/u/[token]`. The browser card always works; the wallet passes are
   *credential-dependent* (see §5).
3. **Scan.** Staff open the scanner from any screen in the dashboard and scan the
   customer's code. Any phone, tablet or laptop camera — no dedicated hardware.
4. **Earn.** The scan writes a visit, applies the loyalty rules, updates progress
   and unlocks a reward if one is due. This is one transaction; there is no state
   in which the customer was charged a visit but not credited for it.
5. **Return.** Campaigns, automations and proximity notifications bring them back.

---

## 3. What is in the box

| Area | Status | Where it lives |
| --- | --- | --- |
| Loyalty engine — stamps, points, tiers, rewards | Implemented | `lib/loyalty/rules.ts`, migrations `000004`/`000006` |
| Counter scanner | Implemented | `docs/STORE_EXPERIENCE.md` |
| Wallet passes | Credential-dependent | `docs/WALLET_PROXIMITY.md` |
| Proximity / geofenced notifications | Credential-dependent | `docs/WALLET_PROXIMITY.md` |
| CRM — profiles, segments, tags, notes, import/export | Implemented | `lib/segments/definition.ts`, `lib/customers/service.ts` |
| Campaigns — email, SMS, WhatsApp, wallet push | Partial (see §5) | `lib/messaging/dispatch.ts` |
| Automations — welcome, birthday, win-back | Implemented | `lib/automations/engine.ts` |
| Analytics | Implemented | migration `000007`; computed from `activity_events` + `loyalty_ledger` |
| AI | Credential-dependent | `lib/ai/capabilities.ts` |
| Gift cards, memberships, referrals | Implemented | migration `000013` |
| Subscriptions and billing | Implemented | `docs/SUBSCRIPTIONS.md` |
| Multi-location | Implemented | `/dashboard/locations` |

---

## 4. Who uses it

Three audiences, three surfaces. Confusing them is how loyalty products end up
asking a barista to understand a segmentation DSL.

- **The owner** — sets the program up once, then reads the dashboard weekly.
  Onboarding, analytics, campaigns, billing.
- **Staff at the counter** — scan, and nothing else. The scanner opens over
  whatever screen they were on and closes back onto it; a customer arriving mid-task
  never costs anyone their work.
- **The customer** — joins, holds a card, gets rewarded. Never sees the word
  "dashboard", never creates a password, and is never asked to install anything.

Roles and permissions are in `docs/SECURITY.md`. Plan-based gating is in
`docs/SUBSCRIPTIONS.md`. The distinction matters: `403` means your role cannot do
this, `402` means your plan cannot.

---

## 5. What is honestly not finished

Kept here rather than in a roadmap deck, because the gap between what a product
does and what its documentation implies is where trust goes.

- **Wallet passes need credentials.** The pass generation, update and
  registration architecture is complete and tested, but Apple requires a paid
  developer account and Google a service account. Without them the product falls
  back to the browser card and says so — it does not pretend to have issued a pass.
- **Messaging needs providers.** Email (Resend), SMS/WhatsApp (Twilio, Meta) are
  wired through one dispatch path that enforces consent, suppression, quiet hours
  and frequency caps. Without keys, campaigns compose and schedule but do not send.
- **AI needs a key.** Every capability degrades to a stated "not configured"
  rather than inventing output. No mock result is ever presented as a real one.
- **No mobile apps.** Deliberate. The customer's wallet is the app, and the
  merchant's browser is the terminal.
- **No POS integrations yet.** The scanner is the integration point today.

For the full, unflattering version, see
[`../PASSIMO_LAUNCH_STATUS.md`](../PASSIMO_LAUNCH_STATUS.md).

---

## 6. What Passimo does not claim

Passimo has not launched. There are no customers, no testimonials, no revenue and
no usage figures — and none appear anywhere in the product or on the marketing
site. The landing page says it is onboarding its first businesses, because that
is true.
