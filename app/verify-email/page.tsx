'use client'

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Loader2, MailCheck, MailX, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiPost, ApiError } from '@/lib/client/api'
import { BrandMark } from '@/components/brand-mark'
import { useI18n } from '@/lib/i18n'

/**
 * Confirms an email address from an emailed link.
 *
 * Unlike the password reset, this one submits on load: there is nothing for the
 * merchant to type, and asking them to press a button on a page they reached by
 * pressing a button is friction with no purpose. A mail-client prefetch
 * consuming the token is harmless here — the outcome it produces is the outcome
 * the link was for.
 */
export default function VerifyEmailPage() {
  return (
    <React.Suspense fallback={null}>
      <VerifyEmail />
    </React.Suspense>
  )
}

type State = 'working' | 'verified' | 'failed' | 'missing'

function VerifyEmail() {
  const { t } = useI18n()
  const params = useSearchParams()
  const token = params.get('token') ?? ''

  const [state, setState] = React.useState<State>(token ? 'working' : 'missing')
  const [message, setMessage] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!token) return
    let cancelled = false

    void (async () => {
      try {
        await apiPost('/api/v1/auth/verify-email', { token })
        if (!cancelled) setState('verified')
      } catch (caught) {
        if (cancelled) return
        setMessage(caught instanceof ApiError ? caught.message : null)
        setState('failed')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm text-center">
        <BrandMark className="mx-auto size-11" />

        <div className="mt-8 rounded-2xl border bg-card p-6 shadow-sm">
          {state === 'working' && (
            <div role="status" className="flex flex-col items-center gap-3">
              <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">{t('auth.verify.working')}</p>
            </div>
          )}

          {state === 'verified' && (
            <div role="status" className="flex flex-col items-center gap-3">
              <MailCheck className="size-8 text-emerald-600" aria-hidden />
              <h1 className="text-lg font-semibold">{t('auth.verify.done')}</h1>
              <p className="text-sm text-muted-foreground">{t('auth.verify.doneHelp')}</p>
              <Button asChild className="mt-2 h-11 w-full gap-2">
                <Link href="/dashboard">
                  {t('auth.verify.toDashboard')}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
            </div>
          )}

          {(state === 'failed' || state === 'missing') && (
            <div role="alert" className="flex flex-col items-center gap-3">
              <MailX className="size-8 text-muted-foreground" aria-hidden />
              <h1 className="text-lg font-semibold">{t('auth.verify.failed')}</h1>
              <p className="text-sm text-muted-foreground">
                {message ?? t('auth.verify.failedHelp')}
              </p>
              <Button asChild variant="outline" className="mt-2 h-11 w-full">
                <Link href="/dashboard/settings">{t('auth.verify.resend')}</Link>
              </Button>
            </div>
          )}
        </div>

        <p className="mt-6 text-sm text-muted-foreground">
          <Link href="/login" className="underline-offset-4 hover:underline">
            {t('auth.reset.backToLogin')}
          </Link>
        </p>
      </div>
    </main>
  )
}
