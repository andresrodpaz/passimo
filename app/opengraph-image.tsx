import { ImageResponse } from 'next/og'
import { getLocale } from '@/lib/i18n/server'
import { createTranslator } from '@/lib/i18n/translate'
import { env } from '@/lib/env'

/**
 * The link preview card.
 *
 * Every share of this product — a WhatsApp message between two café owners, a
 * Slack link, a tweet — renders this image, and without it the platforms fall
 * back to a blank rectangle or a scraped fragment of the page. It is generated
 * rather than designed as a PNG for two reasons: it stays in step with the
 * wordmark automatically, and it can be produced in the visitor's language.
 *
 * Localised on purpose. A Spanish merchant pasting the link into a Spanish group
 * chat and getting an English preview is the mixed-language failure at its most
 * public — the one place where the leak is visible to people who never opened
 * the site.
 *
 * `twitter-image` is not a separate file: Next.js falls back to the Open Graph
 * image for Twitter when no dedicated one exists, and two files would be two
 * places to update.
 */

/** The configured origin's host, without protocol or trailing slash. */
function siteHost(): string {
  try {
    return new URL(env.appUrl).host
  } catch {
    return 'localhost:3000'
  }
}

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Passimo — loyalty that lives in your customers’ wallet'

export default async function OpengraphImage() {
  const locale = await getLocale()
  const t = createTranslator(locale)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#1c1917',
          padding: 80,
          fontFamily: 'sans-serif',
        }}
      >
        {/* The wordmark, drawn with the same strokes as `BrandMark`. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 72,
              height: 72,
              borderRadius: 20,
              background: '#fefdfb',
            }}
          >
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#1c1917"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 20V6a2 2 0 0 1 2-2h12" />
              <path d="M4 12h11" />
              <circle cx="17" cy="16" r="4" />
            </svg>
          </div>
          <div style={{ color: '#fefdfb', fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>
            {t('common.appName')}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              color: '#fefdfb',
              fontSize: 76,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -2.5,
              // Wraps rather than overflows: the Spanish headline is longer than
              // the English one, and satori does not shrink text to fit.
              maxWidth: 960,
            }}
          >
            {t('landing.hero.titleLead')} {t('landing.hero.titleAccent')}
          </div>
          <div style={{ color: '#a8a29e', fontSize: 34, lineHeight: 1.3, maxWidth: 900 }}>
            {t('common.tagline')}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ height: 6, width: 72, borderRadius: 3, background: '#f59e0b' }} />
          {/*
            The host this deployment actually answers on, not a hardcoded one. An
            Open Graph card is the most-shared surface the product has, and
            printing a domain that does not resolve on it is a claim the link
            works — which is exactly what someone clicking a shared card tests.
          */}
          <div style={{ color: '#78716c', fontSize: 26 }}>{siteHost()}</div>
        </div>
      </div>
    ),
    size
  )
}
