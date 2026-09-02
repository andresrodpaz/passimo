import Link from 'next/link'
import { Compass } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandMark } from '@/components/brand-mark'
import { getLocale } from '@/lib/i18n/server'
import { createTranslator } from '@/lib/i18n/translate'

/**
 * The catch-all 404.
 *
 * Without this file every unknown path — a mistyped dashboard route, a stale
 * link in an old email, a crawler probing for `/wp-admin` — rendered Next's
 * built-in page: black Helvetica on white, the string "404", English regardless
 * of the visitor's language, and no way back. On a product sold to Spanish local
 * businesses that is the one screen guaranteed to look like somebody else's
 * software.
 *
 * Deliberately not clever. A 404 is read for two seconds; it needs the brand, a
 * sentence in the right language, and one link.
 */
export default async function NotFound() {
  const locale = await getLocale()
  const t = createTranslator(locale)

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
      <Link href="/" className="flex items-center gap-2.5">
        <BrandMark />
        <span className="text-base font-semibold tracking-tight">{t('common.appName')}</span>
      </Link>

      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <Compass className="size-7 text-muted-foreground" aria-hidden />
      </div>

      <div className="max-w-sm space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">{t('errors.notFoundPageTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('errors.notFoundPageBody')}</p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link href="/">{t('errors.notFoundHome')}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">{t('errors.notFoundDashboard')}</Link>
        </Button>
      </div>
    </main>
  )
}
