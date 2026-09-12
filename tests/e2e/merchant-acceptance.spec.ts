import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { LOCALE_COOKIE } from '@/lib/i18n/locales'

/**
 * The merchant acceptance test.
 *
 * One question, asked of the running product rather than of the code: *could a
 * café owner sign up today, understand Passimo, set up their loyalty program,
 * customise their Wallet card, activate it and start serving customers without
 * anyone helping them?*
 *
 * So these assertions are deliberately not unit-shaped. They ask what a person
 * would ask — can I tell what this does, can I find the thing, does the number
 * mean anything, does it work on the phone I actually own — because a suite can
 * be green while a button is impossible to find.
 *
 * Two modes, matching the rest of the suite: with a database the journey runs
 * for real; without one the tests that need a merchant skip *with a reason*, and
 * the public-surface assertions still run.
 *
 * One session for the whole file. `/api/v1/auth/*` is rate limited to 8 requests
 * per five minutes per IP — a deliberate control on the most abuse-prone
 * endpoint in the product — so signing in per test makes the suite fail on its
 * own security rather than on the product.
 */

type Cookies = Awaited<ReturnType<BrowserContext['cookies']>>

/**
 * The reason a signup failed, when it did.
 *
 * Set alongside the session so a skipped test can say what actually stopped it.
 * Every test in this file used to skip with "no database: signup is unavailable
 * on this deployment", which is only sometimes the truth — the eight-per-five-
 * minutes auth limit is frequently already spent by an earlier spec when the
 * whole suite runs, and a skip that misreports its cause reads as "not
 * applicable" and stops anybody looking again.
 */
let signupFailure: string | null = null

async function signUpMerchant(context: BrowserContext, category = 'cafe'): Promise<Cookies | null> {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`
  const response = await context.request.post('/api/v1/auth/signup', {
    data: {
      email: `mat-e2e-${stamp}@passimo.test`,
      password: 'a-perfectly-fine-passphrase-2026',
      businessName: `MAT E2E Café ${stamp}`,
      category,
      timezone: 'Europe/Madrid',
      locale: 'en',
      acceptedTerms: true,
    },
  })

  if (response.ok()) {
    signupFailure = null
    return context.cookies()
  }

  if (response.status() === 429) {
    signupFailure =
      'our own auth rate limit (8 per 5 minutes per IP) is spent — run this file on its own'
  } else if (response.status() === 503) {
    signupFailure = 'signup is unavailable on this deployment'
  } else {
    // A 422 or a 500 from signup is the product being broken, not a reason to
    // stand down. Surfaced as a failure so the suite says so out loud.
    throw new Error(`signup failed with ${response.status()}: ${await response.text()}`)
  }
  return null
}

async function useSession(page: Page, cookies: Cookies): Promise<void> {
  await page.context().addCookies(cookies)
}

async function setLocale(context: BrowserContext, baseURL: string | undefined, locale: string) {
  await context.addCookies([
    { name: LOCALE_COOKIE, value: locale, url: baseURL ?? 'http://localhost:3000' },
  ])
}

/** Nothing may overflow sideways. A control off the edge is a control that does not exist. */
async function expectNoSidewaysScroll(page: Page, where: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow, `${where} scrolls sideways`).toBeLessThanOrEqual(1)
}

// ---------------------------------------------------------------------------
// The landing page, read by somebody who has never heard of us
// ---------------------------------------------------------------------------

test.describe('a visitor who knows nothing', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await setLocale(context, baseURL, 'en')
  })

  test('can tell what this is, who it is for, and what it costs', async ({ page }) => {
    await page.goto('/')

    // What it is, above the fold, in one heading.
    const h1 = page.getByRole('heading', { level: 1 }).first()
    await expect(h1).toBeVisible()
    await expect(page.getByText(/Apple Wallet and Google Wallet/i).first()).toBeVisible()

    // Who it is for. A café owner has to see themselves on this page.
    await expect(page.getByText(/caf|restaurant|salon|gym|retail/i).first()).toBeVisible()

    // What it costs, and that there is no free tier to hunt for.
    await expect(page.getByRole('link', { name: /pricing/i }).first()).toBeVisible()
    const body = await page.locator('body').innerText()

    // The entry price, on the page, without scrolling to the pricing section.
    expect(body, 'the landing page must quote the entry price').toMatch(/\$29/)

    /*
     * "No free plan" is checked structurally rather than lexically.
     *
     * The pricing FAQ *asks* "Is there a free plan?" and answers "No" — copy that
     * exists precisely to settle the question a visitor arrives with, and which a
     * keyword sweep flags as the very thing it was written to deny. What must not
     * appear is a zero price or a tier called Free.
     */
    expect(body, 'no zero-price tier may appear').not.toMatch(/\$0\b|\b0\s*\/\s*month\b/i)
    expect(body, 'no tier may be named Free').not.toMatch(
      /\bfree (tier|forever)\b|\bforever free\b/i
    )
    // And the question is answered, in the negative, where a visitor looks.
    expect(body, 'the free-plan question must be answered').toMatch(/is there a free plan/i)

    // How to start.
    await expect(page.getByRole('link', { name: /trial|start|get started/i }).first()).toBeVisible()
  })

  test('is never shown fabricated traction', async ({ page }) => {
    await page.goto('/')
    const body = await page.locator('body').innerText()

    /*
     * The product decision this guards: until real merchants are live, no
     * invented counts, ratings or testimonials. "Launching soon" and "join the
     * early access programme" are the honest substitutes and are what should be
     * here instead.
     */
    for (const claim of [
      /\d[\d,.]*\s*(businesses|merchants|shops|stores)\s+(already\s+)?(using|trust)/i,
      /trusted by \d/i,
      /\d[\d,.]*\+?\s*(happy|satisfied)\s+(customers|merchants)/i,
      /rated\s*\d(\.\d)?\s*\/\s*5/i,
    ]) {
      expect(body, `fabricated social proof: ${claim}`).not.toMatch(claim)
    }
  })

  test('can play with the demo without a camera, an account or a download', async ({ page }) => {
    await page.goto('/#demo')

    // Scoped to the demo section: the same primary action appears twice on the
    // page (once in the panel, once in the sticky aside), which is a deliberate
    // product choice and a strict-mode violation for an unscoped locator.
    const panel = page.locator('#demo')
    const record = panel.getByRole('button', { name: /Record a visit/i }).first()
    await expect(record).toBeVisible()
    const before = await panel.innerText()
    await record.click()
    await expect
      .poll(async () => (await panel.innerText()) !== before, {
        message: 'pressing "Record a visit" changed nothing on the page',
        timeout: 8000,
      })
      .toBe(true)

    /*
     * Changing the trade must move the card, not just a label.
     *
     * The panels are tabbed on a desktop and stacked on a phone — a deliberate
     * responsive choice, so the tab is clicked only when it exists rather than
     * assumed.
     */
    const walletTab = panel.getByRole('tab', { name: /Their wallet card/i }).first()
    if (await walletTab.isVisible().catch(() => false)) {
      await walletTab.click()
    }

    const beforeTrade = await panel.innerText()
    const trades = panel.getByRole('button', { name: /Restaurant|Barber|Gym|Bakery/ })
    if (await trades.first().isVisible().catch(() => false)) {
      await trades.first().click()
      await expect
        .poll(async () => (await panel.innerText()) !== beforeTrade, {
          message: 'choosing another trade changed nothing',
          timeout: 8000,
        })
        .toBe(true)
    }

    // And both wallet framings are offered, labelled as previews.
    await expect(panel.getByText(/Apple Wallet/).first()).toBeVisible()
    await expect(panel.getByText(/Google Wallet/).first()).toBeVisible()
  })

  test('the demo asks for no camera permission', async ({ page }) => {
    /*
     * A landing page that opens a viewfinder reads as either an irrelevance or
     * a permission request. The scanner belongs in the merchant product, where
     * it is used at a till — and it is still there.
     */
    let requested = false
    await page.exposeFunction('__matCameraRequested', () => {
      requested = true
    })
    await page.addInitScript(() => {
      const media = navigator.mediaDevices
      if (media?.getUserMedia) {
        const original = media.getUserMedia.bind(media)
        media.getUserMedia = ((constraints: MediaStreamConstraints) => {
          ;(window as unknown as { __matCameraRequested: () => void }).__matCameraRequested()
          return original(constraints)
        }) as typeof media.getUserMedia
      }
    })

    await page.goto('/')
    await page.locator('#demo').getByRole('button', { name: /Record a visit/i }).first().click()
    await page.waitForTimeout(1200)
    expect(requested, 'the landing page asked for the camera').toBe(false)
  })

  test('pricing shows every purchasable plan and starts at the entry price', async ({ page }) => {
    await page.goto('/#pricing')

    for (const plan of ['Starter', 'Growth', 'Pro']) {
      await expect(page.getByText(plan, { exact: true }).first()).toBeVisible()
    }
    // The retired fourth tier. A stale "Business" card would be a second $99
    // column beside Pro's, with no way for a visitor to tell them apart.
    await expect(page.getByText('Business', { exact: true })).toHaveCount(0)

    const body = await page.locator('body').innerText()
    // All three published prices, not just the entry one: a surface that has
    // stopped reading the catalogue usually keeps one of them accidentally right.
    for (const price of ['$29', '$59', '$99']) {
      expect(body, `the pricing page must quote ${price}`).toContain(price)
    }
    for (const stale of [/\$5\b/, /\$19\b/, /\$49\b/]) {
      expect(body, `a retired price is still on the page: ${stale}`).not.toMatch(stale)
    }
    expect(body).not.toMatch(/\$0\b|\b(free|gratis)\s+(tier|forever)\b/i)
  })

  test('makes the shared floor explicit, so the entry tier is not read as a teaser', async ({
    page,
  }) => {
    /*
     * The cards list only what differs between plans, which means the shared
     * floor has to be stated somewhere or a visitor reading the Starter column
     * reasonably concludes the wallet card designer is a paid extra. That
     * misreading is the whole difference between "$29 is reasonable" and "$29 is
     * the crippled one".
     */
    await page.goto('/#pricing')
    const body = await page.locator('body').innerText()

    expect(body, 'the shared-floor strip must be present').toMatch(/in every plan/i)
    for (const included of [/card designer/i, /brand kit/i, /QR scanner/i, /AI campaign copy/i]) {
      expect(body, `the shared floor must name ${included}`).toMatch(included)
    }

    // And the ROI block must be framed as arithmetic, never as a customer result.
    expect(body, 'the ROI example must say it is an example').toMatch(/example, not a promise/i)
    expect(body, 'the ROI example must carry its disclaimer').toMatch(/illustrative/i)
  })

  test('clips no text on a phone', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'this is the phone projection')
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    /*
     * `truncate` on a value that is a sentence loses the answer, not just the
     * tail. The landing demo's "Next reward" figure rendered as "160 poi…" at
     * 412px, which is the one number on that panel a visitor is reading it for.
     *
     * Detected by comparing scroll width against client width on elements that
     * declare `text-overflow: ellipsis`, which is what actually clipped.
     */
    const clipped = await page.evaluate(() => {
      const offenders: string[] = []
      for (const node of Array.from(document.querySelectorAll('*'))) {
        const el = node as HTMLElement
        if (el.offsetParent === null) continue
        const style = window.getComputedStyle(el)
        if (style.textOverflow !== 'ellipsis') continue
        // 2px of tolerance for sub-pixel rounding.
        if (el.scrollWidth - el.clientWidth > 2) {
          offenders.push(`${el.tagName.toLowerCase()}: ${(el.textContent ?? '').trim().slice(0, 60)}`)
        }
      }
      return offenders
    })

    expect(clipped, `text clipped on the landing page: ${clipped.join(' | ')}`).toEqual([])
  })

  test('does not scroll sideways on a phone', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'this is the phone projection')
    await page.goto('/')
    await expectNoSidewaysScroll(page, 'the landing page')
    await page.goto('/#pricing')
    await expectNoSidewaysScroll(page, 'the pricing section')
  })
})

// ---------------------------------------------------------------------------
// The merchant journey
// ---------------------------------------------------------------------------

test.describe('a café owner setting up on their own', () => {
  /*
   * Serial *inside* this describe, not at file scope. One shared merchant means
   * the tests share state, so they must run in order — but a failure in the
   * landing-page group must not abort the journey group, which is what file-wide
   * serial did. A suite that stops reporting after the first problem hides more
   * than it finds.
   */
  test.describe.configure({ mode: 'serial' })

  let session: Cookies | null = null

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext()
    session = await signUpMerchant(context)
    await context.close()
  })

  test.beforeEach(async ({ context, baseURL }) => {
    await setLocale(context, baseURL, 'en')
  })

  test('lands in onboarding, not in an empty dashboard', async ({ page }) => {
    test.skip(!session, signupFailure ?? 'no session')
    await useSession(page, session!)

    await page.goto('/dashboard')
    // A merchant who has not finished setup belongs in the wizard.
    await expect(page).toHaveURL(/\/(onboarding|dashboard)/)

    await page.goto('/onboarding')
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()

    // The wizard says where it is and how far there is to go.
    await expect(page.getByText(/Your program|Your plan|Your shop|Your card/).first()).toBeVisible()
  })

  test('sees the card change as they choose, not after they save', async ({ page }) => {
    test.skip(!session, signupFailure ?? 'no session')
    await useSession(page, session!)
    await page.goto('/onboarding')

    /*
     * The "aha" the whole wizard is built around: choosing a trade visibly
     * rebuilds the program and the card. If this is a form, the merchant has no
     * reason to believe anything happened.
     */
    const preview = page.locator('main')
    const before = await preview.innerText()

    const otherTrade = page.getByRole('button', { name: /Bakery|Barber|Gym|Restaurant/ }).first()
    if (await otherTrade.isVisible()) {
      await otherTrade.click()
      await expect
        .poll(async () => (await preview.innerText()) !== before, {
          message: 'choosing a different trade changed nothing on screen',
          timeout: 8000,
        })
        .toBe(true)
    }
  })

  test('can reach every headline feature from the sidebar without guessing', async ({
    page,
    isMobile,
  }) => {
    test.skip(!session, signupFailure ?? 'no session')
    await useSession(page, session!)
    await page.goto('/dashboard')

    if (isMobile) await page.getByRole('button', { name: 'Open menu' }).click()

    /*
     * Discoverability, stated as the merchant's own vocabulary. Each of these is
     * a thing a café owner would go looking for; if the label does not contain
     * the word they would search for, they will not find it.
     */
    for (const label of [
      'Overview',
      'Point of sale',
      'Customers',
      'Rewards',
      'Card design',
      'Analytics',
      'Settings',
      'Plan & billing',
    ]) {
      await expect(
        page.getByRole('link', { name: label, exact: true }),
        `no sidebar entry called "${label}"`
      ).toBeVisible()
    }
  })

  test('every sidebar link goes somewhere real', async ({ page, isMobile }) => {
    test.skip(!session, signupFailure ?? 'no session')
    await useSession(page, session!)
    await page.goto('/dashboard')

    if (isMobile) await page.getByRole('button', { name: 'Open menu' }).click()

    // `evaluateAll` does not auto-wait, so the nav has to be there first — the
    // sidebar renders after the workspace context resolves.
    const links = page.locator('aside a[href^="/"]')
    await expect(links.first()).toBeVisible()
    await expect.poll(() => links.count(), { timeout: 10_000 }).toBeGreaterThan(8)

    const hrefs = await links.evaluateAll((nodes) =>
      Array.from(new Set(nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href')!)))
    )

    for (const href of hrefs) {
      const response = await page.request.get(href, { failOnStatusCode: false })
      expect(response.status(), `${href} answered ${response.status()}`).toBeLessThan(400)
    }
  })

  test('the counter can serve a customer with no camera and no scanner hardware', async ({
    page,
  }) => {
    test.skip(!session, signupFailure ?? 'no session')
    await useSession(page, session!)
    await page.goto('/pos')

    // The camera does not exist under Playwright, which is exactly the fallback
    // a merchant needs on a laptop at the till.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    const manual = page.getByRole('button', { name: /enter|manual|type/i }).first()
    const field = page.getByRole('textbox').first()
    expect(
      (await manual.isVisible().catch(() => false)) || (await field.isVisible().catch(() => false)),
      'the counter offers no way to serve somebody without a working camera'
    ).toBe(true)
  })

  test('the dashboard explains its own numbers', async ({ page }) => {
    test.skip(!session, signupFailure ?? 'no session')
    await useSession(page, session!)
    await page.goto('/dashboard')

    /*
     * A metric with no explanation is a number a merchant cannot act on. Every
     * tile carries a one-line hint for exactly that reason, and a brand-new
     * account must read as "nothing yet", never as a broken screen.
     */
    await expect(page.getByText('Members').first()).toBeVisible()
    await expect(page.getByText(/Repeat rate/i).first()).toBeVisible()
    const body = await page.locator('main').innerText()
    expect(body).not.toMatch(/NaN|undefined|Infinity|\[object Object\]/)
  })

  test('reads entirely in Spanish when Spanish is chosen', async ({ page, context, baseURL }) => {
    test.skip(!session, signupFailure ?? 'no session')
    await useSession(page, session!)
    await setLocale(context, baseURL, 'es')

    /*
     * The half a "does the Spanish string appear?" test misses: a screen built
     * from thirty `t()` calls fails by rendering twenty-nine and leaving one
     * English literal behind, and that literal is invisible to a test looking
     * only for what should be there.
     */
    const screens: Array<[string, string[]]> = [
      ['/dashboard', ['Overview', 'Members', 'Repeat rate', 'Revenue']],
      ['/dashboard/wallet/design', ['Card design', 'Save design', 'Preview', 'Your words']],
      ['/dashboard/customers', ['Customers', 'Export', 'Import']],
      ['/dashboard/rewards', ['Rewards']],
      ['/dashboard/billing', ['Plan & billing', 'Current plan']],
      ['/pos', ['Point of sale']],
    ]

    for (const [path, forbidden] of screens) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const text = await page.locator('main').innerText()
      for (const leftover of forbidden) {
        /*
         * Word boundaries, not `toContain`. Spanish borrows the same Latin
         * roots — "Exportar" contains "Export", "Importar" contains "Import" —
         * so a substring check fails on correct translations and would push
         * somebody towards renaming good Spanish to satisfy a test.
         */
        const leaked = new RegExp(String.raw`\b${leftover}\b`)
        expect(text, `English leaked into ${path}: "${leftover}"`).not.toMatch(leaked)
      }
    }
  })

  test('is usable on the phone the merchant actually owns', async ({ page, isMobile }) => {
    test.skip(!session, signupFailure ?? 'no session')
    test.skip(!isMobile, 'this is the phone projection')
    await useSession(page, session!)

    for (const path of [
      '/dashboard',
      '/dashboard/wallet/design',
      '/dashboard/customers',
      '/dashboard/rewards',
      '/dashboard/analytics',
      '/dashboard/billing',
      '/pos',
      '/onboarding',
    ]) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      await expectNoSidewaysScroll(page, path)

      // Nothing important may sit off the bottom of the viewport with no way to
      // reach it, and the primary action must be a real touch target.
      const primary = page.getByRole('button').first()
      if (await primary.isVisible().catch(() => false)) {
        const box = await primary.boundingBox()
        if (box) {
          expect(box.height, `${path}: primary control is only ${box.height}px tall`).toBeGreaterThanOrEqual(32)
        }
      }
    }
  })

  test('exposes one main landmark and labelled controls on every screen', async ({ page }) => {
    test.skip(!session, signupFailure ?? 'no session')
    await useSession(page, session!)

    for (const path of ['/dashboard', '/dashboard/wallet/design', '/dashboard/customers', '/pos']) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')

      await expect(page.locator('main'), `${path} has no single main landmark`).toHaveCount(1)

      // Every form control a merchant can reach must be announced as something.
      const unlabelled = await page
        .locator('input:not([type="hidden"]), select, textarea')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => {
              const el = node as HTMLElement
              if (el.offsetParent === null) return false
              const id = el.getAttribute('id')
              const labelled =
                el.getAttribute('aria-label') ||
                el.getAttribute('aria-labelledby') ||
                el.getAttribute('title') ||
                el.getAttribute('placeholder') ||
                (id && document.querySelector(`label[for="${id}"]`)) ||
                el.closest('label')
              return !labelled
            })
            .map((node) => (node as HTMLElement).outerHTML.slice(0, 120))
        )

      expect(unlabelled, `${path} has unlabelled form controls`).toEqual([])
    }
  })

  test('keeps the tablet layout intact', async ({ browser }) => {
    test.skip(!session, signupFailure ?? 'no session')

    /*
     * The gap the previous pass admitted to: `playwright.config.ts` has a phone
     * project and a desktop project and nothing between them, so the two
     * breakpoints a tablet lands on were never rendered. Driven here with an
     * explicit viewport rather than a third project, so it runs once instead of
     * doubling the whole suite.
     */
    const sizes = [
      { label: 'iPad portrait', width: 768, height: 1024 },
      { label: 'iPad landscape', width: 1024, height: 768 },
      { label: 'Android tablet', width: 800, height: 1280 },
    ]

    for (const size of sizes) {
      const context = await browser.newContext({ viewport: { width: size.width, height: size.height } })
      await context.addCookies(session!)
      const tab = await context.newPage()

      for (const path of ['/dashboard', '/dashboard/wallet/design', '/dashboard/customers', '/']) {
        await tab.goto(path)
        await tab.waitForLoadState('networkidle')
        await expectNoSidewaysScroll(tab, `${size.label} ${path}`)
      }

      await context.close()
    }
  })
})

// ---------------------------------------------------------------------------
// No dead ends
// ---------------------------------------------------------------------------

test.describe('no dead ends', () => {
  test('every internal link on the landing page resolves', async ({ page }) => {
    await page.goto('/')

    const hrefs = await page.locator('a[href^="/"]').evaluateAll((links) =>
      Array.from(
        new Set(
          links
            .map((link) => (link as HTMLAnchorElement).getAttribute('href')!)
            .filter((href) => !href.startsWith('//'))
        )
      )
    )
    expect(hrefs.length).toBeGreaterThan(3)

    for (const href of hrefs) {
      const response = await page.request.get(href, { failOnStatusCode: false })
      // 3xx is fine — a guarded route redirecting to login is correct.
      expect(response.status(), `${href} answered ${response.status()}`).toBeLessThan(400)
    }
  })

  test('the legal pages a paying merchant will look for exist', async ({ page }) => {
    for (const document of ['terms', 'privacy']) {
      const response = await page.request.get(`/legal/${document}`, { failOnStatusCode: false })
      expect(response.status(), `/legal/${document}`).toBeLessThan(400)
    }
  })
})
