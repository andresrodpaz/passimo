'use client'

import Link from 'next/link'
import { CloudOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'

/**
 * Shown only when a merchant opens a page that was never cached while offline.
 *
 * Its job is to say the one thing that matters: visits already scanned are safe. A
 * merchant whose connection dies mid-shift will assume they have lost the morning's
 * customers unless told otherwise, and that assumption is what makes them stop using
 * the product.
 *
 * A client component so the copy is translated: this screen is most likely to be read
 * by someone standing behind a counter under pressure, which is the worst possible
 * moment to be shown a language they do not use.
 */
export default function OfflinePage() {
  const { t } = useI18n()

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 p-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-muted">
        <CloudOff className="size-7 text-muted-foreground" aria-hidden />
      </span>

      <div className="max-w-sm space-y-2">
        <h1 className="text-xl font-semibold">{t('errors.offline')}</h1>
        <p className="text-sm text-muted-foreground">{t('errors.offlineBody')}</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild>
          <Link href="/pos">{t('dashboard.nav.scan')}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">{t('dashboard.nav.overview')}</Link>
        </Button>
      </div>
    </main>
  )
}
