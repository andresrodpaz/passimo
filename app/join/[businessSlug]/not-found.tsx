import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandMark } from '@/components/brand-mark'
import { getLocale } from '@/lib/i18n/server'
import { createTranslator } from '@/lib/i18n/translate'

/**
 * What a customer sees when the QR they scanned points at nothing.
 *
 * This boundary exists because making `/join/{slug}` answer a real 404 — instead
 * of 200 with a client-side message — hands the response to Next's default
 * not-found page: unstyled, English-only, and with no way onward. Correct status
 * code, worse experience. Both have to be right.
 *
 * The audience is not a merchant debugging a link. It is somebody standing in a
 * shop who scanned a sticker, and the two things they need are "this is not your
 * fault" and "here is what to do". So the copy names the likely cause — a
 * business that closed its program, or a mistyped address — rather than saying
 * "404", and the only action offered goes somewhere that works.
 */
export default async function JoinNotFound() {
  const locale = await getLocale()
  const t = createTranslator(locale)

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex items-center gap-2.5">
        <BrandMark />
        <span className="text-base font-semibold tracking-tight">{t('common.appName')}</span>
      </div>

      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <SearchX className="size-7 text-muted-foreground" aria-hidden />
      </div>

      <div className="max-w-sm space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">{t('join.notFound')}</h1>
        <p className="text-sm text-muted-foreground">{t('join.notFoundBody')}</p>
      </div>

      <Button asChild variant="outline">
        <Link href="/">{t('join.notFoundAction')}</Link>
      </Button>
    </main>
  )
}
