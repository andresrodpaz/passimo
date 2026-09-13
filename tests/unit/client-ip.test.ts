import { afterEach, describe, expect, it, vi } from 'vitest'
import { clientIp } from '@/lib/rate-limit'

/**
 * Which hop of `X-Forwarded-For` the rate limiter believes.
 *
 * Every IP-keyed limit in the product is keyed on this one function — sign-in
 * (8 per five minutes), password reset, public enrolment (10 a minute),
 * proximity reports. It used to return `split(',')[0]`, the leftmost entry,
 * which is precisely the value a client writes for itself. Demonstrated against
 * a running instance before the fix:
 *
 *     POST /api/v1/public/join  ×13          → 404 ×10, 429 ×3
 *     POST /api/v1/public/join  ×5  with
 *       X-Forwarded-For: 10.1.2.<n>          → 404 ×5   (all admitted)
 *
 * So the cap was advisory: rotate the header and it does not exist. That turns
 * the sign-in limit from a brute-force control into a formality, which is the
 * reason this is tested at the unit level rather than left to the integration
 * suite — it is the kind of line that gets "simplified" back.
 *
 * The header grows left to right (each proxy appends what it saw), so with one
 * trusted proxy the rightmost entry is the proxy's own observation and the only
 * one a client cannot write.
 */

afterEach(() => {
  vi.unstubAllEnvs()
})

function withForwarded(value: string | null, extra: Record<string, string> = {}): Request {
  const headers = new Headers(extra)
  if (value !== null) headers.set('x-forwarded-for', value)
  return new Request('http://localhost/api/v1/public/join', { headers })
}

describe('clientIp', () => {
  it('reads the proxy’s own observation, not the client’s claim', () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', '1')

    // A client that forges a prefix: the real address is what the proxy appended.
    expect(clientIp(withForwarded('10.1.2.3, 203.0.113.9'))).toBe('203.0.113.9')
    // A client that sends nothing: one entry, and it is the real one.
    expect(clientIp(withForwarded('203.0.113.9'))).toBe('203.0.113.9')
  })

  it('cannot be made to return an attacker-chosen value by padding the chain', () => {
    /*
     * The bypass in its purest form: the attacker varies the part they control
     * and expects a different rate-limit key each time. Every one of these must
     * key on the same real address.
     */
    vi.stubEnv('TRUSTED_PROXY_HOPS', '1')

    const keys = new Set(
      ['10.1.2.1', '10.1.2.2', '198.51.100.7', 'not-an-ip', '::1'].map((forged) =>
        clientIp(withForwarded(`${forged}, 203.0.113.9`))
      )
    )

    expect(keys).toEqual(new Set(['203.0.113.9']))
  })

  it('honours a deeper proxy chain when one is configured', () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', '2')
    // client, edge, app-proxy → the address the *first trusted* proxy saw.
    expect(clientIp(withForwarded('10.1.2.3, 203.0.113.9, 192.0.2.1'))).toBe('203.0.113.9')
  })

  it('a chain shorter than configured falls back to the leftmost entry — which is client-written', () => {
    /*
     * Pinned as a *limitation*, not as a guarantee. Clamping returns the
     * leftmost entry, and in this situation that is the value the client wrote,
     * so `TRUSTED_PROXY_HOPS` must match the real proxy depth: a `1` on an app
     * with nothing in front of it leaves the bypass fully intact.
     *
     * Verified live during the audit — against the local dev server, which has
     * no proxy, a single forged entry was still honoured. The configuration is
     * the control here, and this test exists so that stays visible.
     */
    vi.stubEnv('TRUSTED_PROXY_HOPS', '3')
    expect(clientIp(withForwarded('10.1.2.3'))).toBe('10.1.2.3')
  })

  it('ignores the header entirely when no proxy is trusted', () => {
    // Directly exposed: every entry is attacker-supplied, so none is believed.
    vi.stubEnv('TRUSTED_PROXY_HOPS', '0')
    expect(clientIp(withForwarded('10.1.2.3, 203.0.113.9'))).toBe('unknown')
    expect(clientIp(withForwarded(null, { 'x-real-ip': '203.0.113.9' }))).toBe('unknown')
  })

  it('uses the proxy-set single-value headers only when a proxy is expected', () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', '1')
    expect(clientIp(withForwarded(null, { 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9')
    expect(clientIp(withForwarded(null, { 'cf-connecting-ip': '203.0.113.9' }))).toBe('203.0.113.9')
  })

  it('never throws on a malformed header', () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', '1')
    expect(clientIp(withForwarded(''))).toBe('unknown')
    expect(clientIp(withForwarded(' , , '))).toBe('unknown')
    expect(clientIp(withForwarded(null))).toBe('unknown')
  })
})
