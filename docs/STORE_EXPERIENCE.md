# Store Experience

> **The rule:** the complete product works on the devices a merchant already owns.
> No QR scanner, no barcode gun, no POS terminal, no kiosk, no special printer.
> "Install nothing. Buy nothing. Scan and go."

Hardware integrations may exist as *optional* extras. Nothing in the core product
may depend on them. If a feature would need a merchant to buy hardware, it gets
redesigned until it runs on a phone, a tablet or a laptop with a webcam.

---

## What runs the shop

| Device | Supported | How |
| --- | --- | --- |
| iPhone / iPad (Safari 17+) | Yes | Native `BarcodeDetector` |
| iPhone / iPad (older Safari) | Yes | JS decoder fallback |
| Android phone / tablet (Chrome) | Yes | Native `BarcodeDetector` |
| Laptop / desktop with webcam (Chrome, Edge) | Yes | Native `BarcodeDetector` |
| Firefox (any platform) | Yes | JS decoder fallback |
| Any device, camera broken or absent | Yes | Manual fallbacks |

There is no build of the app to install. The scanner is a web page.

---

## The check-in flow

1. Customer opens Apple Wallet or Google Wallet.
2. Merchant taps **Scan** — from the dashboard header on any screen, or `/pos`.
3. The camera opens immediately; no "start" tap.
4. The code is read, typically in well under a second.
5. The customer is identified and the visit is credited **in one request**.
6. Points, stamps or cashback are awarded by the rules engine.
7. The wallet pass update is enqueued automatically.
8. An unlocked reward appears instantly, redeemable from the same card.
9. The camera never closed — the next customer can be scanned already.

Target: under five seconds, start to finish. The scan and the credit are a single
round trip (`POST /api/v1/scan` with `action: "checkin"`) precisely so this holds
on café wifi.

---

## Architecture

```
camera frame
   │
   ├─ lib/client/qr-decode.ts ......... BarcodeDetector → jsQR fallback
   ├─ lib/client/use-qr-scanner.ts .... continuous loop, torch, camera switch,
   │                                    audio + haptics, auto-recovery
   ├─ lib/client/use-counter-scan.ts .. calls the API, or queues when offline
   │     └─ lib/client/offline-queue.ts  IndexedDB queue + customer cache
   │
   ▼
POST /api/v1/scan
   ├─ lib/scan/payload.ts ............. classify the raw string (pure, tested)
   ├─ lib/scan/resolve.ts ............. resolve to a typed entity
   ├─ lib/scan/counter.ts ............. build the counter view of the customer
   └─ lib/scan/checkin.ts ............. credit the visit via the loyalty engine
```

The server owns classification. Every client — the POS, the dashboard scanner,
onboarding, a future native app, a partner integration — resolves identifiers
identically because none of them parse anything themselves.

### What a scan can be

`lib/scan/payload.ts` classifies any of these without being told which it is:

- a bare customer id (what Apple and Google wallet barcodes encode)
- a signed card token, or the `/card/<token>` URL from any email
- a `passimo://customer/<id>` custom-scheme payload
- a reward claim code, gift card code or referral code — **all ambiguous by
  shape**, so the resolver probes every table that could own it, concurrently
- a `/join/<slug>?ref=<code>` sign-up link (this person is not a member yet)
- an email address, a phone number, a `mailto:` or `tel:` contact scan
- free text, which falls through to a ranked fuzzy customer search

A cashier is never asked to pick a mode before pointing the camera.

### Decoding, in layers

1. **`BarcodeDetector`** — hardware-backed. QR, PDF417, Aztec, Data Matrix and
   the 1D formats on printed loyalty cards.
2. **jsQR**, dynamically imported — only downloaded where step 1 is missing, so
   most merchants never fetch the ~40 kB (gzipped) decoder at all. Runs two
   alternating passes per frame budget: full frame, then a centre crop at higher
   effective resolution for small or distant codes. Both inversions are tried, so
   dark-mode passes and inverted print still read.
3. **Manual entry** — never blocked.

Decoding is throttled to ~12 fps, not the display refresh rate. A QR does not
appear and vanish inside 80 ms, and scanning at 60 fps only heats the device and
flattens its battery halfway through a shift.

### Conditions it handles

- **Poor lighting** — torch control where the device exposes it.
- **Multiple cameras** — front/rear switch on phones and multi-camera tablets.
- **Rotation** — the decoder is orientation-agnostic; layout is responsive.
- **Cracked screens, damaged codes** — QR error correction plus the centre-crop
  and inverted passes recover most of what is recoverable.
- **A dropped camera track** — device sleep, or another app taking the camera.
  Detected and restarted rather than showing a frozen frame.
- **A backgrounded tab** — the stream is released (battery, privacy indicator)
  and re-acquired on return.
- **The same card left in front of the lens** — suppressed by a 3 s cooldown that
  refreshes while the card stays in view.

### Feedback

Haptic always (silent, universally welcome). Audio is opt-in per session — some
counters are quiet rooms — and is a synthesised blip rather than an asset, so it
works on a cold cache with nothing to load. Results are announced through an
`aria-live` region for screen-reader users.

---

## Fallbacks

The merchant is never blocked. When the camera is unavailable — or simply slower
than their thumbs — the same screen offers:

- **Recent** — who was here lately. Resolves most check-ins with no typing.
- **Regulars** — VIP customers ranked by spend.
- **Search** — name, phone, email or code, debounced.
- **Enter** on the search box sends the raw text through the *same resolver*, so a
  typed gift card or reward code behaves exactly like a scanned one.

Served by `GET /api/v1/counter/roster`, which the service worker keeps in a
stale-while-revalidate cache so the list is present the instant the camera fails,
including when the network is already gone.

---

## Offline

A café's wifi drops. The queue does not.

| Situation | Behaviour |
| --- | --- |
| Scan while offline, customer known from cache | Served immediately, credit queued |
| Scan while offline, customer unknown | Credit queued; staff told it will sync |
| Connection returns | Queue drains automatically, oldest first |
| Page reloaded while offline | Service worker serves the cached shell |
| Screen never cached | `/offline` page, stating scans are safe |

**Why replaying is safe:** every queued scan carries the idempotency key it was
created with, and `passimo_record_earn` dedupes on it in Postgres. A queued scan
can be replayed any number of times and credits exactly once.

**What is deliberately *not* cached:** authenticated customer data. A stale
balance is worse than an honest "you are offline" — staff would quote a wrong
number to a customer's face — and personal data must not outlive the session on a
shared counter device. The counter roster is the single exception, and it contains
only what is already on screen when it is fetched.

A scan that fails permanently (4xx: customer deleted, access revoked) is dropped
rather than retried forever, so one poisoned record cannot block the visits behind
it — and the merchant is told, by name, which visits to re-enter. See
`decideFlushOutcome` in `lib/client/offline-queue.ts`.

---

## Installing as an app

`app/manifest.ts` makes the counter installable. `start_url` is `/pos`, not the
dashboard: a device pinned to the till has one job. Added to a home screen it
runs standalone — no browser chrome eating the viewport — on hardware the merchant
already owns.

The service worker (`public/sw.js`) registers only in production, and never in
development, where it would cache half-built assets and look exactly like a broken
app.

---

## Permissions

| Action | Permission |
| --- | --- |
| Identify a customer | `customers:read` |
| Credit a visit | `loyalty:earn` |
| Redeem a reward | `loyalty:redeem` |
| Take payment from a gift card | `loyalty:redeem` + `gift_cards` plan feature |

A viewer can still look someone up — useful at a counter — so the scanner opens in
identify-only mode rather than refusing.

---

## Required headers

The scanner will not open without these; they are set in `middleware.ts` and
asserted in `tests/e2e/counter.spec.ts`.

```
Permissions-Policy: camera=(self), microphone=(), ...
Content-Security-Policy: ... media-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self'
```

A camera is also unreachable outside a secure context. Over plain HTTP the UI says
so explicitly instead of surfacing a bare permission error.

---

## Testing

| Layer | Where |
| --- | --- |
| Payload classification (30 cases) | `tests/unit/scan-payload.test.ts` |
| Offline drop-or-retry decision | `tests/unit/offline-queue.test.ts` |
| Manifest, service worker, headers, access control | `tests/e2e/counter.spec.ts` |

The camera itself cannot be asserted in CI — there is no real one — so the decoder
is covered by unit tests and the *fallback* paths are covered end to end, which is
the half that has to work when something has already gone wrong.

### Verifying by hand

1. Run a production build (`pnpm build && pnpm start`) over HTTPS or `localhost`.
2. Open `/pos` on a phone. The camera should open with no extra tap.
3. Open `/join/<your-slug>` on a second device to get a real wallet card, then
   scan it. Confirm the balance moves and the card stays open for the next scan.
4. In Firefox, confirm the scan still works — that exercises the JS fallback.
5. In devtools, go offline and scan again. Expect "Saved offline", then automatic
   sync when you re-enable the network, and no double-credit.
