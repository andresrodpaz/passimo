'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, Loader2, Gift, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { LoyaltyCard } from '@/components/loyalty-card'
import { apiPost } from '@/lib/client/api'
import { toastError } from '@/lib/client/api-errors'
import { WalletButtons } from '@/components/wallet-buttons'
import { useI18n } from '@/lib/i18n'
import { resolveBrandPalette } from '@/lib/brand/kit'
import type { PublicJoinData } from '@/lib/public/join'

type JoinResult = {
  card_url: string
  apple_wallet_url: string
  google_wallet_url: string
  referral_code: string
}

/**
 * The enrolment form.
 *
 * Interactive, so a client component — but it no longer *fetches*. The business,
 * its palette and its rewards arrive from the server render, which is what makes
 * the first paint branded rather than a spinner. See `lib/public/join.ts` for why
 * that mattered enough to split this file out of `page.tsx`.
 *
 * The single conversion point of the whole product: a customer standing at a
 * counter with 20 seconds of patience. So it asks for one required field, shows
 * the reward before asking for anything, and captures consent explicitly rather
 * than burying it.
 */
export function JoinFlow({ slug, data }: { slug: string; data: PublicJoinData }) {
  const { t, locale } = useI18n()
  const searchParams = useSearchParams()
  const referralCode = searchParams.get('ref') ?? undefined

  const [result, setResult] = React.useState<JoinResult | null>(null)
  const [email, setEmail] = React.useState('')
  const [name, setName] = React.useState('')
  const [birthday, setBirthday] = React.useState('')
  const [marketing, setMarketing] = React.useState(true)
  const [accepted, setAccepted] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const { business, program } = data
  const goal = program?.goal_amount ?? 10
  /*
   * The same resolution the wallet card uses, so this page and the pass a
   * customer installs 20 seconds later cannot show different colours — and so a
   * stored text colour that fails contrast against the background is recomputed
   * rather than rendered.
   */
  const palette = resolveBrandPalette({
    primaryColor: business.primary_color,
    accentColor: business.accent_color,
    textColor: business.text_color,
  })

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!accepted) {
      setError(t('join.needsTerms'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = await apiPost<JoinResult>('/api/v1/public/join', {
        businessSlug: slug,
        email: email.trim().toLowerCase(),
        name: name.trim() || undefined,
        birthday: birthday || undefined,
        referralCode,
        /*
         * The locale the page is being read in, not a re-sniff of
         * `navigator.language`. The i18n provider has already resolved the
         * viewer's preference (cookie, then Accept-Language, then default), and
         * this is what every message we later send this customer is written in —
         * so the two must agree.
         */
        locale,
        consents: { email: true, sms: false, whatsapp: false, marketing },
        acceptedTerms: true,
      })
      setResult(response)
    } catch (cause) {
      // Our own translated copy first; the server's English sentence only for a
      // code we have no copy for. See `lib/client/api-errors.ts`.
      setError(toastError(cause, t, 'join.failed'))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
        <div className="w-full max-w-[390px] text-center">
          <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Check className="size-8" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('join.done')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('join.doneBody')}</p>

          <div className="mt-6">
            <WalletButtons
              appleUrl={result.apple_wallet_url}
              googleUrl={result.google_wallet_url}
            />
          </div>

          <a
            href={result.card_url}
            className="mt-4 inline-block text-sm font-medium underline underline-offset-4"
          >
            {t('join.openInBrowser')}
          </a>

          <div className="mt-8 rounded-xl border bg-card p-4 text-left">
            <p className="text-sm font-medium">{t('join.inviteTitle')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('join.inviteBody')}</p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-muted px-3 py-2 text-center font-mono text-lg tracking-widest">
                {result.referral_code}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const url = `${window.location.origin}/join/${business.slug}?ref=${result.referral_code}`
                  if (navigator.share) {
                    void navigator.share({ title: business.name, url })
                  } else {
                    void navigator.clipboard.writeText(url)
                  }
                }}
              >
                {t('join.share')}
              </Button>
            </div>
          </div>

          <p className="mt-6 text-xs text-muted-foreground">{t('join.emailedTo', { email })}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
      <div className="w-full max-w-[390px]">
        <div className="flex justify-center">
          <LoyaltyCard
            businessName={business.name}
            backgroundColor={palette.background}
            accentColor={palette.accent}
            textColor={palette.text}
            stampCount={goal}
            activeStamps={0}
            reward={program?.reward_description ?? t('join.cardRewardFallback')}
            logoUrl={business.logo_url}
            className="w-full"
          />
        </div>

        <div className="mt-7 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('join.title', { business: business.name })}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('join.subtitle', {
              goal,
              unit: program?.unit_plural ?? t('join.unitFallback'),
              reward: program?.reward_description ?? t('join.rewardFallback'),
            })}
          </p>
        </div>

        {data.rewards.length > 0 && (
          <ul className="mt-5 space-y-1.5 rounded-xl border bg-card p-4">
            {data.rewards.slice(0, 3).map((reward) => (
              <li key={reward.id} className="flex items-center gap-2 text-sm">
                <Gift className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{reward.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {reward.cost} {program?.unit_plural ?? ''}
                </span>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="join-email">{t('join.email')}</Label>
            <Input
              id="join-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-12 text-base"
              placeholder={t('join.emailPlaceholder')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="join-name" className="text-xs text-muted-foreground">
                {t('join.firstName')}
              </Label>
              <Input
                id="join-name"
                autoComplete="given-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="join-birthday" className="text-xs text-muted-foreground">
                {t('join.birthday')}
              </Label>
              <Input
                id="join-birthday"
                type="date"
                value={birthday}
                onChange={(event) => setBirthday(event.target.value)}
                className="h-11"
              />
            </div>
          </div>
          <p className="-mt-1 text-xs text-muted-foreground">{t('join.birthdayHint')}</p>

          <div className="space-y-2.5 rounded-lg border p-3">
            <label className="flex items-start gap-2.5 text-xs leading-relaxed">
              <Checkbox
                checked={accepted}
                onCheckedChange={(value) => setAccepted(value === true)}
                className="mt-0.5"
                aria-describedby="terms-text"
              />
              <span id="terms-text">{t('join.consentTerms', { business: business.name })}</span>
            </label>
            <label className="flex items-start gap-2.5 text-xs leading-relaxed">
              <Checkbox
                checked={marketing}
                onCheckedChange={(value) => setMarketing(value === true)}
                className="mt-0.5"
              />
              <span>{t('join.consentMarketing')}</span>
            </label>
          </div>

          <Button type="submit" className="h-12 w-full gap-2 text-base" disabled={busy}>
            {busy ? <Loader2 className="size-5 animate-spin" /> : null}
            {busy ? t('join.submitting') : t('join.submit')}
          </Button>
        </form>

        {data.locations.length > 0 && (
          <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="size-3.5" />
            {data.locations[0]!.address ?? data.locations[0]!.city ?? business.city}
          </p>
        )}
      </div>
    </main>
  )
}
