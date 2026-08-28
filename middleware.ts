import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, decodeSessionToken, sessionSecret } from '@/lib/auth/session-token'

/**
 * Edge middleware: route protection and security headers.
 *
 * It answers exactly one question — "does this request carry a cookie we
 * issued, that has not expired?" — and uses the answer to keep signed-out
 * visitors off the dashboard and signed-in ones off the login form. That is a
 * navigation concern, and an HMAC verification against a local secret answers it
 * in microseconds with no database and no network.
 *
 * It is **not** the authorisation boundary. Whether the session is still valid
 * (revoked? account suspended? password changed?) and what the actor may do are
 * decided server-side on every request in `lib/auth/context.ts`, which reads the
 * session row and the tenant membership. A cookie that passes here and fails
 * there gets a 401 from the API and a redirect from the page — which is the
 * correct outcome, and the reason middleware is allowed to be optimistic.
 */

const PROTECTED_PREFIXES = ['/dashboard', '/pos', '/onboarding', '/admin']

/** Signed-in users are bounced away from these; they have nothing to offer them. */
const AUTH_ROUTES = ['/login', '/signup']

/**
 * Endpoints that authenticate by signature or shared secret and can never have
 * a session. They skip the cookie check entirely but still receive the security
 * headers, because a webhook endpoint is still an endpoint.
 */
const SESSIONLESS_PREFIXES = [
  '/api/v1/billing/webhook',
  '/api/v1/integrations/',
  '/api/v1/jobs/',
  '/api/v1/cron/',
  '/api/v1/health',
]

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request })
  const { pathname } = request.nextUrl

  if (SESSIONLESS_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return withSecurityHeaders(response, request)
  }

  const needsDecision =
    PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    AUTH_ROUTES.includes(pathname)

  if (!needsDecision) return withSecurityHeaders(response, request)

  let signedIn = false
  try {
    const token = request.cookies.get(SESSION_COOKIE)?.value
    signedIn = (await decodeSessionToken(sessionSecret(), token)) !== null
  } catch {
    /*
     * The signing secret is missing. Treated as "not signed in" rather than as a
     * crash: a misconfigured deployment should present a login page, not a 500
     * on every route, and the sign-in attempt itself will fail with an
     * actionable message from `lib/env.ts`.
     */
    signedIn = false
  }

  if (!signedIn && PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    // Preserve the destination so signing in lands where the user intended.
    url.searchParams.set('next', pathname + request.nextUrl.search)
    return withSecurityHeaders(NextResponse.redirect(url), request)
  }

  if (signedIn && AUTH_ROUTES.includes(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return withSecurityHeaders(NextResponse.redirect(url), request)
  }

  return withSecurityHeaders(response, request)
}

function withSecurityHeaders(response: NextResponse, request: NextRequest): NextResponse {
  const headers = response.headers

  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('X-Frame-Options', 'DENY')
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  headers.set(
    'Permissions-Policy',
    'camera=(self), microphone=(), geolocation=(self), payment=(self), interest-cohort=()'
  )
  headers.set('X-DNS-Prefetch-Control', 'on')

  // HSTS only over HTTPS, so local development is unaffected.
  if (request.nextUrl.protocol === 'https:') {
    headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  }

  // Public wallet/card pages are embeddable by design (email clients, wallet
  // apps); the dashboard is not.
  if (request.nextUrl.pathname.startsWith('/card') || request.nextUrl.pathname.startsWith('/join')) {
    headers.delete('X-Frame-Options')
  }

  headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // Next.js injects inline bootstrap scripts; 'unsafe-inline' is required
      // until the framework emits nonces for them in this configuration.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // The scanner attaches a camera MediaStream to a <video>, and the offline
      // service worker is a same-origin script.
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      /*
       * Same-origin only. Every server dependency — database, wallet providers,
       * email, AI — is called from the Node runtime, never from the browser, so
       * the client never needs to reach a third-party host. Keeping this closed
       * means an injected script has nowhere to exfiltrate to.
       */
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      'upgrade-insecure-requests',
    ].join('; ')
  )

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the wallet pass endpoints, which are
     * fetched by Apple/Google infrastructure that must not be redirected.
     *
     * `sw.js` and the manifest are excluded too: both are requested outside any
     * session (the manifest by the OS installer, the worker by the browser on
     * update checks), so evaluating a session for them is wasted work.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon|sw\\.js|manifest\\.webmanifest|api/v1/wallet|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
