'use client'

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Loader2, Mail, Lock, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiPost, ApiError } from '@/lib/client/api'
import { BrandMark } from '@/components/brand-mark'
import { useI18n } from '@/lib/i18n'

export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginForm />
    </React.Suspense>
  )
}

/** Accepts only a same-origin absolute path, so `next` cannot become a redirector. */
function safeNext(value: string | null): string {
  if (!value) return '/dashboard'
  if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard'
  return value
}

function LoginForm() {
  const { t, locale } = useI18n()
  const params = useSearchParams()
  /*
   * Only same-origin paths are honoured. A `next` of `//evil.example` or
   * `https://evil.example` would otherwise turn the login page into an open
   * redirect that a phishing email could point at.
   */
  const next = safeNext(params.get('next'))

  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [resetSent, setResetSent] = React.useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiPost('/api/v1/auth/login', { email: email.trim(), password })
      // Full navigation so middleware re-reads the freshly written cookie.
      window.location.assign(next)
    } catch (caught) {
      if (caught instanceof ApiError) {
        /*
         * The server already decides what is safe to disclose: one message for
         * "wrong password" and "no such account" alike, but a specific one for a
         * locked or suspended account, where the person has already proven they
         * know the address and needs to know why they cannot get in.
         */
        setError(
          caught.status === 429
            ? t('auth.login.tooMany')
            : caught.status >= 500
              ? t('auth.login.unreachable')
              : caught.message
        )
        return
      }
      setError(t('auth.login.unreachable'))
    } finally {
      setBusy(false)
    }
  }

  async function handleReset() {
    if (!email.trim()) {
      setError(t('auth.login.resetNeedsEmail'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await apiPost('/api/v1/auth/password/reset-request', { email: email.trim(), locale })
      // Always report success, for the same enumeration reason as above.
      setResetSent(true)
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 429
          ? t('auth.login.tooMany')
          : t('auth.login.unreachable')
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
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">
            {t('auth.login.title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('auth.login.subtitle')}</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm"
        >
          {resetSent && (
            <div
              role="status"
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400"
            >
              {t('auth.login.resetSent', { email })}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">{t('auth.login.email')}</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-11 pl-9"
                placeholder={t('auth.login.emailPlaceholder')}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t('auth.login.password')}</Label>
              <button
                type="button"
                onClick={handleReset}
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                {t('auth.login.forgot')}
              </button>
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-11 pl-9"
                placeholder="••••••••••"
              />
            </div>
          </div>

          <Button type="submit" className="h-11 w-full gap-2" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {busy ? t('auth.login.submitting') : t('auth.login.submit')}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('auth.login.noAccount')}{' '}
          <Link
            href="/signup"
            className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t('auth.login.signUp')}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </p>
      </div>
    </main>
  )
}
