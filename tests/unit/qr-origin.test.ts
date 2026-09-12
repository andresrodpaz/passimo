import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/v1/public/qr/route'

/**
 * The QR endpoint's origin rule.
 *
 * It renders any URL you hand it into a PNG, so without a restriction it is a
 * free phishing-image host on somebody else's domain — point it at a lookalike
 * bank, print the code, and the image is served by us. The rule is that the
 * target must sit on this deployment's own origin, and it is the only thing
 * standing between the product and that.
 *
 * These tests exist because of how the rule failed in practice. `settings` and
 * `onboarding` build the join URL from `window.location.origin` while the
 * endpoint validates against `NEXT_PUBLIC_APP_URL`, so serving the app on an
 * origin that variable does not name — another port, a preview deployment, a
 * proxy on a different host — made every QR in the product `403`. An `<img>`
 * cannot render a JSON error, so the merchant got a broken-image glyph.
 *
 * The fix was a diagnosis in the UI (`components/join/join-qr.tsx`), not a
 * loosening here. That makes this file the regression guard on the rule: the
 * obvious way to make a broken image go away is to stop checking, and these
 * assertions are what should fail if anybody does.
 *
 * `env.appUrl` is a getter over `process.env`, so stubbing the variable is
 * enough — no module mock, and nothing to reset beyond `unstubAllEnvs`.
 */

afterEach(() => {
  vi.unstubAllEnvs()
})

function request(target: string, extra = ''): Request {
  return new Request(
    `http://localhost:3000/api/v1/public/qr?data=${encodeURIComponent(target)}${extra}`
  )
}

describe('QR origin allowlist', () => {
  it('renders a PNG for a URL on the configured origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')

    const response = await GET(request('http://localhost:3000/join/some-cafe'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(100)
  })

  it('refuses a URL on a different origin, which is the misconfiguration case', async () => {
    /*
     * Exactly the shape of the bug: the deployment is configured for
     * `passimo.app` but is being used on localhost, so the join URL the
     * dashboard builds is refused. A `403` is the correct answer — the UI is
     * responsible for explaining it.
     */
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://passimo.app')

    const response = await GET(request('http://localhost:3000/join/some-cafe'))

    expect(response.status).toBe(403)
    expect(response.headers.get('content-type')).not.toBe('image/png')
  })

  it('refuses an attacker-supplied origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')

    /*
     * Asserted as "not rendered" rather than as one status code, because the
     * two rejections are reached by different paths and both are correct:
     * `…3000.evil.example` is refused at `new URL()` with a 400 (the parser
     * reads `3000.evil.example` as a port and rejects it), the rest reach the
     * origin comparison and get a 403. Pinning a single code here would make
     * the test about which branch fired instead of about whether an attacker's
     * URL can be turned into a PNG on our domain.
     */
    for (const target of [
      'https://evil.example/login',
      'https://evil.example/join/some-cafe',
      // A lookalike host that merely *contains* the allowed one.
      'http://localhost:3000.evil.example/join/some-cafe',
      // Right host, wrong port — a different origin by definition.
      'http://localhost:9999/join/some-cafe',
      // Right host, wrong scheme.
      'https://localhost:3000/join/some-cafe',
    ]) {
      const response = await GET(request(target))
      expect(response.status, `${target} was encoded`).toBeGreaterThanOrEqual(400)
      expect(response.headers.get('content-type'), `${target} returned an image`).not.toBe(
        'image/png'
      )
    }
  })

  it('refuses a non-absolute target rather than guessing an origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')

    // A relative path has no origin to check, so it cannot be allowed.
    const response = await GET(request('/join/some-cafe'))
    expect(response.status).toBe(400)
  })

  it('requires a target at all', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')

    const response = await GET(new Request('http://localhost:3000/api/v1/public/qr'))
    expect(response.status).toBe(400)
  })

  it('offers the print-ready download on the allowed origin only', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')

    const ok = await GET(request('http://localhost:3000/join/some-cafe', '&size=1024&download=1'))
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-disposition')).toContain('attachment')

    // `download=1` must not become a way around the origin rule.
    const blocked = await GET(request('https://evil.example/x', '&size=1024&download=1'))
    expect(blocked.status).toBe(403)
  })
})
