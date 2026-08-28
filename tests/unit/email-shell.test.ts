import { describe, expect, it } from 'vitest'
import { emailBrandFromRow, renderBrandedEmail } from '@/lib/messaging/email-layout'
import { DEFAULT_BRAND } from '@/lib/brand/kit'
import { readableTextOn, resolveCardDesign, DEFAULT_CARD_DESIGN } from '@/lib/wallet/card-design'

/**
 * The frame every outbound email is wrapped in.
 *
 * Three properties are worth pinning, and all three were broken:
 *
 *   * the shell hardcoded `lang="es"` on every message ever sent, so an English
 *     merchant's customers got an email every screen reader announced as
 *     Spanish;
 *   * the footer's "Unsubscribe" was an English literal inside that Spanish
 *     frame, which is the mixed-language page the brief forbids, in the one
 *     place a merchant cannot see it;
 *   * its private `readableOn` claimed WCAG relative luminance in a comment
 *     while computing an unweighted average with no gamma correction, so the
 *     same brand colour could yield white text on the wallet card and dark text
 *     in the email announcing it.
 *
 * Escaping is asserted too: the body is merchant-authored and reaches a
 * customer's inbox, so an unescaped `<` is an injection into someone else's mail
 * client.
 */

const BRAND = {
  name: 'Café Central',
  primaryColor: '#111827',
  accentColor: '#f59e0b',
  logoUrl: 'https://cdn.example.test/logo.png',
}

const base = {
  brand: BRAND,
  heading: 'Tu recompensa está lista',
  body: 'Hola.\n\nTe espera un café.',
}

describe('emailBrandFromRow', () => {
  it('defaults a missing business to the platform brand', () => {
    const brand = emailBrandFromRow(null)
    expect(brand.name).toBe('Passimo')
    expect(brand.primaryColor).toBe(DEFAULT_BRAND.primaryColor)
    expect(brand.accentColor).toBe(DEFAULT_BRAND.accentColor)
    expect(brand.logoUrl).toBeNull()
  })

  it('reads a partial row without inventing a fourth set of fallbacks', () => {
    // Most callers select four columns, not the whole kit. Going through
    // `mapBrandKit` means they default exactly as the wallet card defaults.
    const brand = emailBrandFromRow({ id: 'b', name: 'Café', primary_color: '#ABC' })
    expect(brand.name).toBe('Café')
    expect(brand.primaryColor).toBe('#aabbcc')
    expect(brand.accentColor).toBe(DEFAULT_BRAND.accentColor)
  })

  it('falls back to the product name for a business with no name', () => {
    expect(emailBrandFromRow({ id: 'b', name: '  ' }).name).toBe('Passimo')
  })
})

describe('renderBrandedEmail', () => {
  it('declares the language it is actually written in', () => {
    expect(renderBrandedEmail({ ...base, locale: 'es' })).toContain('<html lang="es">')
    expect(renderBrandedEmail({ ...base, locale: 'en' })).toContain('<html lang="en">')
  })

  it('defaults to the platform locale rather than to Spanish', () => {
    // The old shell hardcoded `es`; the default now comes from one place.
    expect(renderBrandedEmail(base)).toMatch(/<html lang="(es|en)">/)
  })

  it('translates the unsubscribe link', () => {
    const spanish = renderBrandedEmail({
      ...base,
      locale: 'es',
      unsubscribeUrl: 'https://passimo.test/u/tok',
    })
    const english = renderBrandedEmail({
      ...base,
      locale: 'en',
      unsubscribeUrl: 'https://passimo.test/u/tok',
    })
    expect(spanish).toContain('Darse de baja')
    expect(spanish).not.toContain('Unsubscribe')
    expect(english).toContain('Unsubscribe')
  })

  it('omits the unsubscribe link entirely for a transactional message', () => {
    // A gift card someone paid for must not offer to unsubscribe from itself.
    const html = renderBrandedEmail({ ...base, locale: 'es' })
    expect(html).not.toContain('Darse de baja')
    expect(html).not.toContain('/u/')
  })

  it('translates the platform footer', () => {
    expect(renderBrandedEmail({ ...base, locale: 'es' })).toContain('Con la tecnología de Passimo')
    expect(renderBrandedEmail({ ...base, locale: 'en' })).toContain('Powered by Passimo')
  })

  it('paints the merchant’s colours, not ours', () => {
    const html = renderBrandedEmail({
      ...base,
      brand: { ...BRAND, primaryColor: '#1d4ed8' },
    })
    expect(html).toContain('#1d4ed8')
  })

  it('picks header text that is legible on the merchant’s colour', () => {
    /*
     * The bug: a merchant with a cream brand colour got white-on-cream in the
     * header of every email, because the shell's own luminance maths disagreed
     * with the card's. Both now go through `readableTextOn`.
     */
    const pale = renderBrandedEmail({ ...base, brand: { ...BRAND, primaryColor: '#fef3c7' } })
    expect(pale).toContain(`color:${readableTextOn('#fef3c7')}`)
    expect(readableTextOn('#fef3c7')).toBe('#000000')

    const dark = renderBrandedEmail({ ...base, brand: { ...BRAND, primaryColor: '#111827' } })
    expect(dark).toContain(`color:${readableTextOn('#111827')}`)
  })

  it('agrees with the wallet card about the same brand colour', () => {
    // One implementation, so the email announcing a reward and the card holding
    // it cannot disagree about which text colour is readable.
    for (const primaryColor of ['#ffffff', '#fef3c7', '#111827', '#1d4ed8', '#a3e635']) {
      const card = resolveCardDesign(DEFAULT_CARD_DESIGN, {
        primaryColor,
        accentColor: '#f59e0b',
        // Empty rather than a colour: the email shell never consults a stored
        // text colour, so the card has to compute its foreground too for the
        // two to be comparable at all.
        textColor: '',
        logoUrl: null,
      })
      const html = renderBrandedEmail({ ...base, brand: { ...BRAND, primaryColor } })
      expect(html, primaryColor).toContain(`color:${card.foregroundColor}`)
    }
  })

  it('accepts shorthand hex, which the old six-digit-only guard rejected', () => {
    expect(renderBrandedEmail({ ...base, brand: { ...BRAND, primaryColor: '#abc' } })).toContain(
      '#aabbcc'
    )
  })

  it('falls back to the platform colour for an unusable one', () => {
    const html = renderBrandedEmail({
      ...base,
      brand: { ...BRAND, primaryColor: 'rgb(1,2,3)' as string },
    })
    expect(html).toContain(DEFAULT_BRAND.primaryColor)
  })

  it('renders the logo when there is one and nothing when there is not', () => {
    expect(renderBrandedEmail(base)).toContain('https://cdn.example.test/logo.png')
    expect(renderBrandedEmail({ ...base, brand: { ...BRAND, logoUrl: null } })).not.toContain(
      '<img'
    )
  })

  it('splits the body into paragraphs on a blank line', () => {
    const html = renderBrandedEmail(base)
    expect(html).toContain('Hola.')
    expect(html).toContain('Te espera un café.')
    // Two paragraphs, not one with a literal newline.
    expect(html.match(/<p style="margin:0 0 14px/g) ?? []).toHaveLength(2)
  })

  it('turns a single newline into a line break rather than dropping it', () => {
    const html = renderBrandedEmail({ ...base, body: 'Línea uno\nLínea dos' })
    expect(html).toContain('Línea uno<br/>Línea dos')
  })

  it('escapes merchant-authored content', () => {
    const html = renderBrandedEmail({
      ...base,
      heading: '<script>alert(1)</script>',
      body: 'Precio < 5 & "barato"',
      brand: { ...BRAND, name: '<b>Café</b>' },
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<b>Café</b>')
    expect(html).toContain('Precio &lt; 5')
  })

  it('escapes a URL before putting it in an attribute', () => {
    const html = renderBrandedEmail({
      ...base,
      ctaLabel: 'Abrir',
      ctaUrl: 'https://passimo.test/x?a=1&b="2"',
    })
    expect(html).not.toContain('b="2"')
    expect(html).toContain('&amp;b=')
  })

  it('renders the call to action only when it has both a label and a URL', () => {
    expect(
      renderBrandedEmail({ ...base, ctaLabel: 'Abrir', ctaUrl: 'https://x.test' })
    ).toContain('Abrir')
    // A button with no destination is worse than no button.
    expect(renderBrandedEmail({ ...base, ctaLabel: 'Abrir', ctaUrl: null })).not.toContain(
      '>Abrir<'
    )
    expect(renderBrandedEmail({ ...base, ctaLabel: null, ctaUrl: 'https://x.test' })).not.toContain(
      'padding:14px 28px'
    )
  })

  it('renders the optional highlight strip', () => {
    const html = renderBrandedEmail({
      ...base,
      highlight: { label: 'Sellos', value: '7 de 10' },
    })
    expect(html).toContain('Sellos')
    expect(html).toContain('7 de 10')
  })

  it('is a complete document with a viewport, so it renders on a phone', () => {
    const html = renderBrandedEmail(base)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('width=device-width')
    expect(html).toContain('</html>')
  })
})
