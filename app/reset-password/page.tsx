'use client'

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Loader2, Lock, ShieldCheck, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiPost, ApiError } from '@/lib/client/api'
import { BrandMark } from '@/components/brand-mark'
import { useI18n } from '@/lib/i18n'

/**
 * Sets a new password from an emailed link.
 *
 * The token is validated server-side on submit rather than on load. Validating
 * on load would consume a single-use token just because a mail client prefetched
 * the URL — a real failure mode with Outlook and with link scanners — and would
 * leave the merchant staring at "this link has already been used" for a link they
 * had not yet clicked.
 */
export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={null}>
      <ResetPasswordForm />
    </React.Suspense>
  )
}

function ResetPasswordForm() {
  const { t } = useI18n()
  const params = useSearchParams()
  const token = params.get('token') ?? ''

  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    if (password.length < 10) {
      setError(t('auth.reset.tooShort'))
      return
    }
    if (password !== confirm) {
      setError(t('auth.reset.mismatch'))
      return
    }

    setBusy(true)
    setError(null)
    try {
      await apiPost('/api/v1/auth/password/reset', { token, password })
      setDone(true)
      // The reset creates a session, so the dashboard is reachable immediately.
      window.setTimeout(() => window.location.assign('/dashboard'), 1200)
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : t('auth.reset.failed')
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="size-11" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t('auth.reset.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('auth.reset.subtitle')}</p>
        </div>

        {!token ? (
          <div
            role="alert"
            className="rounded-2xl border bg-card p-6 text-sm shadow-sm"
          >
            <p className="font-medium">{t('auth.reset.noToken')}</p>
            <p className="mt-1 text-muted-foreground">{t('auth.reset.noTokenHelp')}</p>
            <Button asChild className="mt-4 h-11 w-full">
              <Link href="/login">{t('auth.reset.backToLogin')}</Link>
            </Button>
          </div>
        ) : done ? (
          <div
            role="status"
            className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-6 text-center shadow-sm"
          >
            <ShieldCheck className="size-8 text-emerald-600" aria-hidden />
            <p className="font-medium">{t('auth.reset.done')}</p>
            <p className="text-sm text-muted-foreground">{t('auth.reset.doneHelp')}</p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm"
          >
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.reset.newPassword')}</Label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-11 pl-9"
                  aria-describedby="password-hint"
                />
              </div>
              <p id="password-hint" className="text-xs text-muted-foreground">
                {t('auth.reset.hint')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm">{t('auth.reset.confirmPassword')}</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                className="h-11"
              />
            </div>

            <Button type="submit" className="h-11 w-full gap-2" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {busy ? t('auth.reset.submitting') : t('auth.reset.submit')}
            </Button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link
            href="/login"
            className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t('auth.reset.backToLogin')}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </p>
      </div>
    </main>
  )
}
