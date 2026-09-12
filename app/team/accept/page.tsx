'use client'

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Loader2, ShieldAlert, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiPost, ApiError } from '@/lib/client/api'
import { BrandMark } from '@/components/brand-mark'
import { useI18n } from '@/lib/i18n'

/**
 * Where a staff invitation link lands.
 *
 * The page does one thing on load: post the token. Everything interesting is in
 * how it handles the two failures.
 *
 * **Not signed in.** Accepting requires a session, because the only proof that
 * you are the invited address is holding an account for it. Rather than
 * rejecting, the page sends the person to sign in or sign up with `next` set to
 * this URL — the token stays in the query string and survives the round trip,
 * so a new colleague can go from an email to a working account without ever
 * being told to "click the link again".
 *
 * **Wrong account.** Distinguished from every other failure on purpose: it is
 * the one the person can fix, and telling them "invalid invitation" would send
 * them to ask for a replacement that fails in exactly the same way.
 */
export default function AcceptInvitePage() {
  const { t } = useI18n()
  const params = useSearchParams()
  const token = params.get('token')

  /*
   * "No token at all" is decided at first render rather than in the effect: it
   * is a property of the URL, known before anything async happens, and setting
   * it from inside the effect is a cascading render for a value that never
   * changes.
   */
  const [state, setState] = React.useState<
    'working' | 'joined' | 'invalid' | 'wrongAccount' | 'signIn'
  >(() => (token ? 'working' : 'invalid'))

  React.useEffect(() => {
    if (!token) return

    let cancelled = false
    void (async () => {
      try {
        await apiPost('/api/v1/team/accept', { token })
        if (cancelled) return
        setState('joined')
        // A moment on "you are in" before the dashboard replaces it, so the
        // outcome is readable rather than a flash.
        window.setTimeout(() => window.location.assign('/dashboard'), 1200)
      } catch (cause) {
        if (cancelled) return
        if (cause instanceof ApiError && cause.status === 401) {
          setState('signIn')
        } else if (cause instanceof ApiError && /sent to/i.test(cause.message)) {
          setState('wrongAccount')
        } else {
          setState('invalid')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [token])

  // Preserved across sign-in so the token is not lost. Read by /login and
  // /signup, which return here once there is a session.
  const next = token ? `/team/accept?token=${encodeURIComponent(token)}` : '/dashboard'

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm text-center">
        <BrandMark className="mx-auto size-11" />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t('team.accept.title')}</h1>

        <div className="mt-6 rounded-xl border bg-card p-6">
          {state === 'working' && (
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t('team.accept.checking')}
            </p>
          )}

          {state === 'joined' && (
            <>
              <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-emerald-500 text-white">
                <Check className="size-6" aria-hidden />
              </div>
              <p className="text-sm font-medium">{t('team.accept.joined')}</p>
            </>
          )}

          {state === 'signIn' && (
            <>
              <p className="text-sm text-muted-foreground">{t('team.accept.signIn')}</p>
              <div className="mt-4 space-y-2">
                <Button asChild className="w-full">
                  <Link href={`/login?next=${encodeURIComponent(next)}`}>
                    {t('team.accept.signInCta')}
                  </Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link href={`/signup?next=${encodeURIComponent(next)}`}>
                    {t('team.accept.signUpCta')}
                  </Link>
                </Button>
              </div>
            </>
          )}

          {(state === 'invalid' || state === 'wrongAccount') && (
            <>
              <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <ShieldAlert className="size-6" aria-hidden />
              </div>
              <h2 className="text-sm font-semibold">{t('team.accept.invalid')}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {state === 'wrongAccount'
                  ? t('team.accept.wrongAccount')
                  : t('team.accept.invalidBody')}
              </p>
              <Button asChild variant="outline" className="mt-4 w-full">
                <Link href="/dashboard">{t('team.accept.open')}</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
