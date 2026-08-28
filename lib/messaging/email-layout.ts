import { escapeHtml } from '@/lib/messaging/providers'
import { DEFAULT_BRAND, mapBrandKit, type BrandKit } from '@/lib/brand/kit'
import { normalizeHex, readableTextOn } from '@/lib/wallet/card-design'
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales'
import { createTranslator } from '@/lib/i18n/translate'

/**
 * Branded transactional/marketing email shell.
 *
 * Hand-written table layout with inline styles: that is what actually renders
 * consistently in Outlook, Gmail clipping and Apple Mail dark mode. It carries
 * the merchant's colours and logo, so the customer sees *their* café — not us.
 *
 * Two things this module deliberately does *not* own:
 *
 *   * **Colour resolution.** It used to, with its own `safeColor` and a
 *     `readableOn` whose comment claimed WCAG relative luminance while actually
 *     computing an unweighted average with no gamma correction and a 0.6
 *     threshold. That disagreed with `resolveCardDesign` often enough to matter:
 *     the same brand colour could produce white text on the wallet card and dark
 *     text in the email announcing it. Both now go through the one
 *     implementation in `lib/wallet/card-design.ts`.
 *   * **Language.** The shell hardcoded `lang="es"` and an English
 *     "Unsubscribe". It now takes the business's locale, like every other piece
 *     of output produced without a request in front of it.
 */

/** The brand fields the shell renders. A subset of the kit, not a second copy. */
export type EmailBrand = Pick<BrandKit, 'name' | 'primaryColor' | 'accentColor' | 'logoUrl'>

export type EmailShellInput = {
  brand: EmailBrand
  /** The business's language. Defaults to the platform default when unknown. */
  locale?: Locale
  heading: string
  body: string
  ctaLabel?: string | null
  ctaUrl?: string | null
  /** Optional stat strip, e.g. "7 of 10 stamps". */
  highlight?: { label: string; value: string } | null
  footerNote?: string | null
  unsubscribeUrl?: string | null
}

/**
 * Adapts a `businesses` row to the shell's brand shape.
 *
 * Goes through `mapBrandKit` so a partial row (most callers select four columns,
 * not the full kit) defaults exactly the way the wallet card and the join page
 * default, rather than through a fourth set of `?? '#111827'` fallbacks.
 */
export function emailBrandFromRow(row: Record<string, unknown> | null): EmailBrand {
  if (!row) {
    return {
      name: 'Passimo',
      primaryColor: DEFAULT_BRAND.primaryColor,
      accentColor: DEFAULT_BRAND.accentColor,
      logoUrl: null,
    }
  }
  const kit = mapBrandKit(row)
  return {
    name: kit.name || 'Passimo',
    primaryColor: kit.primaryColor,
    accentColor: kit.accentColor,
    logoUrl: kit.logoUrl,
  }
}

export function renderBrandedEmail(input: EmailShellInput): string {
  const locale = input.locale ?? DEFAULT_LOCALE
  const t = createTranslator(locale)

  const primary = normalizeHex(input.brand.primaryColor) ?? DEFAULT_BRAND.primaryColor
  const accent = normalizeHex(input.brand.accentColor) ?? primary
  const onPrimary = readableTextOn(primary)
  const paragraphs = input.body
    .split(/\n{2,}/)
    .map((paragraph) => escapeHtml(paragraph).replace(/\n/g, '<br/>'))
    .filter(Boolean)

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light dark"/>
<title>${escapeHtml(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
    paragraphs[0]?.replace(/<[^>]+>/g, '').slice(0, 120) ?? ''
  )}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
      <tr>
        <td style="background:${primary};padding:28px 32px;text-align:center;">
          ${
            input.brand.logoUrl
              ? `<img src="${escapeHtml(input.brand.logoUrl)}" alt="${escapeHtml(
                  input.brand.name
                )}" width="56" height="56" style="border-radius:12px;display:block;margin:0 auto 12px;object-fit:cover;"/>`
              : ''
          }
          <div style="color:${onPrimary};font-size:18px;font-weight:600;letter-spacing:-.01em;">${escapeHtml(
            input.brand.name
          )}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#111827;font-weight:700;letter-spacing:-.02em;">${escapeHtml(
            input.heading
          )}</h1>
          ${paragraphs
            .map(
              (paragraph) =>
                `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#374151;">${paragraph}</p>`
            )
            .join('')}
          ${
            input.highlight
              ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;background:${accent}14;border:1px solid ${accent}33;border-radius:12px;">
                   <tr><td style="padding:18px;text-align:center;">
                     <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;">${escapeHtml(
                       input.highlight.label
                     )}</div>
                     <div style="font-size:30px;font-weight:700;color:${primary};margin-top:4px;">${escapeHtml(
                       input.highlight.value
                     )}</div>
                   </td></tr>
                 </table>`
              : ''
          }
          ${
            input.ctaUrl && input.ctaLabel
              ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
                   <tr><td style="border-radius:10px;background:${primary};">
                     <a href="${escapeHtml(
                       input.ctaUrl
                     )}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:${onPrimary};text-decoration:none;border-radius:10px;">${escapeHtml(
                       input.ctaLabel
                     )}</a>
                   </td></tr>
                 </table>`
              : ''
          }
        </td>
      </tr>
      <tr>
        <td style="padding:0 32px 28px;">
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;"/>
          <p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af;">
            ${input.footerNote ? `${escapeHtml(input.footerNote)}<br/>` : ''}
            ${escapeHtml(input.brand.name)}
            ${
              input.unsubscribeUrl
                ? ` · <a href="${escapeHtml(
                    input.unsubscribeUrl
                  )}" style="color:#9ca3af;text-decoration:underline;">${escapeHtml(
                    t('emails.shell.unsubscribe')
                  )}</a>`
                : ''
            }
          </p>
        </td>
      </tr>
    </table>
    <p style="margin:16px 0 0;font-size:11px;color:#a1a1aa;">${escapeHtml(
      t('emails.shell.poweredBy', { product: t('common.appName') })
    )}</p>
  </td></tr>
</table>
</body>
</html>`
}
