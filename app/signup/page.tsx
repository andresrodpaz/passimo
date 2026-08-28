'use client'

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { apiPost, ApiError } from '@/lib/client/api'
import { BrandMark } from '@/components/brand-mark'
import { useI18n } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'

/**
 * The category list is keys, not labels: the value is what the API stores and the
 * label is what the merchant reads, and only one of those is translatable.
 */
const CATEGORIES = [
  'cafe',
  'bakery',
  'restaurant',
  'bar',
  'barber',
  'beauty',
  'gym',
  'retail',
  'pet',
  'other',
] as const

const PERKS: TranslationKey[] = [
  'auth.signup.perks.wallet',
  'auth.signup.perks.automations',
  'auth.signup.perks.fast',
]

export default function SignupPage() {
  return (
    <React.Suspense fallback={null}>
      <SignupForm />
    </React.Suspense>
  )
}

function SignupForm() {
  const { t } = useI18n()
  const params = useSearchParams()
  const [businessName, setBusinessName] = React.useState('')
  const [category, setCategory] = React.useState('cafe')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const strength = passwordStrength(password, t)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()

    // Validated here rather than by the browser, in the order the fields are
    // read, so the merchant is told about the first thing they actually missed.
    if (!businessName.trim()) {
      setError(t('auth.signup.needsBusinessName'))
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError(t('auth.signup.badEmail'))
      return
    }
    if (password.length < 10) {
      setError(t('auth.signup.passwordTooShort'))
      return
    }
    if (strength.score < 2) {
      setError(t('auth.signup.passwordTooSimple'))
      return
    }

    setBusy(true)
    setError(null)
    try {
      await apiPost('/api/v1/auth/signup', {
        email,
        password,
        businessName,
        category,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: navigator.language.startsWith('es') ? 'es' : 'en',
        referralCode: params.get('ref') ?? undefined,
      })
      window.location.assign('/onboarding')
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : t('auth.signup.failed')
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
            {t('auth.signup.title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('auth.signup.subtitle')}</p>
        </div>

        {/* `noValidate` because our password rule is a strength score, not a
            length — something `minLength` cannot express. Left to the browser,
            a five-character password gets a native tooltip while
            `aaaaaaaaaa` gets our message, so the merchant sees two different
            styles of error for the same mistake and neither reaches the
            screen-reader announcement. The attributes stay on the fields as
            hints for password managers and assistive tech. */}
        <form
          onSubmit={handleSubmit}
          noValidate
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
            <Label htmlFor="businessName">{t('auth.signup.businessName')}</Label>
            <Input
              id="businessName"
              required
              autoFocus
              maxLength={100}
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              className="h-11"
              placeholder={t('auth.signup.businessNamePlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">{t('auth.signup.categoryLabel')}</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="category" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`auth.signup.categories.${option}` as 'auth.signup.categories.cafe')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">{t('auth.signup.email')}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11"
              placeholder={t('auth.signup.emailPlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">{t('auth.signup.password')}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11"
              placeholder={t('auth.signup.passwordPlaceholder')}
              aria-describedby="password-strength"
            />
            <div id="password-strength" className="flex items-center gap-2">
              <div className="flex h-1 flex-1 gap-1" aria-hidden>
                {[0, 1, 2, 3].map((index) => (
                  <div
                    key={index}
                    className={`h-full flex-1 rounded-full transition-colors ${
                      index < strength.score ? strength.color : 'bg-muted'
                    }`}
                  />
                ))}
              </div>
              <span className="w-16 text-right text-xs text-muted-foreground">
                {password ? strength.label : ''}
              </span>
            </div>
          </div>

          <Button type="submit" className="h-11 w-full gap-2" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {busy ? t('auth.signup.submitting') : t('auth.signup.submit')}
          </Button>

          <ul className="space-y-1.5 pt-2 text-xs text-muted-foreground">
            {PERKS.map((key) => (
              <li key={key} className="flex items-center gap-2">
                <Check className="size-3.5 text-emerald-600" aria-hidden />
                {t(key)}
              </li>
            ))}
          </ul>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('auth.signup.hasAccount')}{' '}
          <Link
            href="/login"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t('auth.signup.login')}
          </Link>
        </p>
      </div>
    </main>
  )
}

/**
 * Length-weighted strength meter. Deliberately does not demand symbols: NIST
 * 800-63B found composition rules push people toward weaker, more predictable
 * passwords.
 */
function passwordStrength(
  password: string,
  t: (key: TranslationKey) => string
): { score: number; label: string; color: string } {
  if (!password) return { score: 0, label: '', color: 'bg-muted' }
  let score = 0
  if (password.length >= 10) score += 1
  if (password.length >= 14) score += 1
  if (/[a-z]/.test(password) && /[A-Z0-9]/.test(password)) score += 1
  if (password.length >= 18 || /[^\w\s]/.test(password)) score += 1

  const labels = [
    t('auth.signup.strength.weak'),
    t('auth.signup.strength.fair'),
    t('auth.signup.strength.good'),
    t('auth.signup.strength.strong'),
  ]
  const colors = ['bg-destructive', 'bg-amber-500', 'bg-emerald-500', 'bg-emerald-600']
  const index = Math.max(0, Math.min(3, score - 1))
  return { score, label: labels[index]!, color: colors[index]! }
}
