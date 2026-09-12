'use client'

import * as React from 'react'
import { use } from 'react'
import { Check, Loader2, MailX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiGet, apiPost } from '@/lib/client/api'
import { useI18n } from '@/lib/i18n'
import { createTranslator } from '@/lib/i18n/translate'
import { isLocale, type Locale } from '@/lib/i18n/locales'

type Info = {
  business: { name: string; logo_url: string | null }
  email: string
  /** The language this customer was emailed in. See the note on `translate`. */
  locale?: string
  consents: { email: boolean; sms: boolean; whatsapp: boolean; push: boolean }
}

/**
 * Unsubscribe landing page.
 *
 * Offers "fewer emails" alongside "no emails": a granular choice keeps far more
 * people on the list than an all-or-nothing button, and it is what regulators
 * and inbox providers expect from a bulk sender.
 *
 * Two things about this page that are not obvious.
 *
 * **It renders in the customer's language, not the visitor's.** Every other
 * public page can read a locale cookie, because the visitor arrived through the
 * site. Nobody arrives here that way — they click a link in an email — so the
 * cookie is absent and the platform default would win. That default is Spanish,
 * which meant an English-speaking customer of an English-speaking merchant met a
 * Spanish consent screen, and vice versa. The API therefore reports the locale
 * the message was written in, and this page switches to it as soon as it knows.
 *
 * **The failure state offers a way out.** An expired link used to render one grey
 * sentence on an empty screen, which leaves a person who wants to stop receiving
 * email with nothing to do about it. That is the worst possible dead end on this
 * particular page: the alternative a customer reaches for is the spam button, and
 * that damages the sending domain for every merchant on the platform.
 */
export default function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const { locale: pageLocale } = useI18n()
  const [info, setInfo] = React.useState<Info | null>(null)
  const [error, setError] = React.useState<'invalid' | 'failed' | null>(null)
  const [done, setDone] = React.useState<'email' | 'all' | null>(null)
  const [busy, setBusy] = React.useState(false)

  /*
   * The customer's locale once we have it, the page's until then. `useI18n`
   * cannot be re-pointed from a leaf, so the translator is built directly — the
   * same thing `translatorForBusiness` does on the server for exactly this
   * reason.
   */
  const locale: Locale = isLocale(info?.locale) ? info.locale : pageLocale
  const t = React.useMemo(() => createTranslator(locale), [locale])

  React.useEffect(() => {
    apiGet<Info>(`/api/v1/public/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch(() => setError('invalid'))
  }, [token])

  async function unsubscribe(channel: 'email' | 'all') {
    setBusy(true)
    try {
      await apiPost('/api/v1/public/unsubscribe', { token, channel })
      setDone(channel)
    } catch {
      setError('failed')
    } finally {
      setBusy(false)
    }
  }

  if (error === 'invalid') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
        <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
            <MailX className="size-6 text-muted-foreground" aria-hidden />
          </div>
          <h1 className="mt-4 text-lg font-semibold">{t('unsubscribe.invalid')}</h1>
          {/* Says what to do instead, because "this link is dead" on its own
              sends people to the spam button. */}
          <p className="mt-2 text-sm text-muted-foreground">{t('unsubscribe.invalidBody')}</p>
        </div>
      </main>
    )
  }

  if (!info) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2
          className="size-6 animate-spin text-muted-foreground"
          aria-label={t('common.loading')}
        />
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center">
        {done ? (
          <>
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500 text-white">
              <Check className="size-6" aria-hidden />
            </div>
            <h1 className="mt-4 text-lg font-semibold">{t('unsubscribe.done')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {done === 'all' ? t('unsubscribe.doneAll') : t('unsubscribe.doneMarketing')}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold">
              {t('unsubscribe.title', { business: info.business.name })}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('unsubscribe.sendingTo', { email: info.email })}
            </p>

            {error === 'failed' && (
              <p role="alert" className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {t('unsubscribe.failed')}
              </p>
            )}

            <div className="mt-6 space-y-2">
              <Button
                variant="outline"
                className="h-11 w-full"
                disabled={busy}
                onClick={() => void unsubscribe('email')}
              >
                {busy && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
                {t('unsubscribe.marketingOnly')}
              </Button>
              <Button
                variant="destructive"
                className="h-11 w-full"
                disabled={busy}
                onClick={() => void unsubscribe('all')}
              >
                {t('unsubscribe.everything')}
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">{t('unsubscribe.keepsCard')}</p>
          </>
        )}
      </div>
    </main>
  )
}
