import type { Metadata, Viewport } from 'next'
import { Inter, Geist_Mono } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { ServiceWorkerRegistrar } from '@/components/service-worker'
import { I18nProvider } from '@/lib/i18n'
import { getLocale } from '@/lib/i18n/server'
import { LOCALES, LOCALE_TAGS } from '@/lib/i18n/locales'
import { createTranslator } from '@/lib/i18n/translate'
import { env } from '@/lib/env'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})

/**
 * Metadata follows the visitor's language.
 *
 * A page whose `<title>` is Spanish and whose body is English is the mixed-language
 * failure at its most visible — it shows in the browser tab, in search results and
 * in every link preview. `generateMetadata` runs per request, so the two can never
 * disagree.
 *
 * `metadataBase` is what makes the rest of this object correct rather than
 * merely present. Without it Next.js emits relative `og:image` and `og:url`
 * values, and every scraper that reads them — Slack, WhatsApp, Twitter, iMessage
 * — needs absolute URLs, so a shared link renders with no image at all. It is
 * read from `NEXT_PUBLIC_APP_URL` rather than hardcoded to `passimo.app`, so a
 * preview deployment advertises itself and local development does not try to
 * fetch production assets.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale()
  const t = createTranslator(locale)

  const title = `${t('common.appName')} — ${t('common.tagline')}`
  const description = t('landing.hero.subtitle')
  const base = new URL(env.appUrl)

  return {
    metadataBase: base,
    title: {
      default: title,
      /*
       * Child pages set only their own name; the brand is appended here. One
       * place decides how a title is assembled, so no screen can ship a tab
       * that says only "Settings".
       */
      template: `%s — ${t('common.appName')}`,
    },
    description,
    applicationName: t('common.appName'),
    keywords:
      locale === 'es'
        ? [
            'fidelización',
            'tarjetas digitales',
            'Apple Wallet',
            'Google Wallet',
            'QR',
            'negocios locales',
          ]
        : [
            'loyalty',
            'digital loyalty cards',
            'Apple Wallet',
            'Google Wallet',
            'QR',
            'local business',
          ],
    authors: [{ name: 'Passimo' }],
    /*
     * The canonical URL is the site root rather than the requested path.
     * Language is chosen by cookie and `Accept-Language`, not by a path prefix,
     * so English and Spanish are the same URL — and the pages that *do* vary by
     * path are signed customer links which `robots.ts` keeps out of the index
     * entirely.
     */
    alternates: {
      canonical: '/',
      languages: Object.fromEntries(LOCALES.map((candidate) => [candidate, '/'])),
    },
    openGraph: {
      title,
      description,
      type: 'website',
      url: '/',
      siteName: t('common.appName'),
      locale: LOCALE_TAGS[locale],
    },
    twitter: { card: 'summary_large_image', title, description },
    robots: {
      index: true,
      follow: true,
    },
  }
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fefdfb' },
    { media: '(prefers-color-scheme: dark)', color: '#1c1917' },
  ],
  width: 'device-width',
  initialScale: 1,
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Resolved from the cookie on the server, so the *first* byte is already in the
  // right language. Reading it on the client instead is what used to make a Spanish
  // visitor's first paint English.
  const locale = await getLocale()

  return (
    <html lang={locale} suppressHydrationWarning className="bg-background">
      <body className={`${inter.variable} ${geistMono.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <I18nProvider locale={locale}>
            {children}
            <Toaster />
            <ServiceWorkerRegistrar />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
