'use client'

import * as React from 'react'
import { use } from 'react'
import { Loader2, Gift, Share2, Check, CreditCard, Crown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoyaltyCard } from '@/components/loyalty-card'
import { WalletButtons } from '@/components/wallet-buttons'
import { Meter } from '@/components/metrics'
import { CustomerProximity } from '@/components/wallet/customer-proximity'
import { apiGet, ApiError } from '@/lib/client/api'
import { useI18n } from '@/lib/i18n'
import { resolveBrandPalette } from '@/lib/brand/kit'

type CardData = {
  customer: {
    id: string
    name: string
    member_since: string
    is_vip: boolean
    referral_code: string
    referral_url: string
  }
  business: {
    name: string
    slug: string
    logo_url: string | null
    primary_color: string | null
    accent_color: string | null
    text_color: string | null
    google_review_url: string | null
  }
  loyalty: {
    programs: Array<{
      programId: string
      programName: string
      unitPlural: string
      balance: number
      goalAmount: number | null
      progressPercent: number
      rewardAvailable: boolean
      nextExpiryAt: string | null
      tier: { name: string; color: string } | null
      nextTier: { name: string; remaining: number } | null
    }>
    availableRewards: Array<{
      id: string
      name: string
      description: string | null
      cost: number
      affordable: boolean
    }>
  }
  claimable: Array<{ id: string; code: string; name: string; expires_at: string | null }>
  gift_cards: Array<{
    code: string
    remaining_value: number
    currency: string
    expires_at: string | null
  }>
  memberships: Array<{
    name: string
    perks: string[]
    earn_multiplier: number
    renews_at: string | null
  }>
  wallet: { apple: string; google: string; apple_available: boolean; google_available: boolean }
}

/**
 * The customer's own card.
 *
 * Reached from an email, the wallet pass back-field, or a bookmark. Its job is to make
 * progress feel tangible and give the customer a reason to come back — so the next
 * reward, not the current balance, is the hero.
 *
 * It is also where proximity reaches the roughly half of customers who never install a
 * wallet pass: `CustomerProximity` offers them the nearest store and the current
 * offers, through the same engine that drives Apple and Google.
 */
export default function CardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const { t, formatCurrency, formatDate } = useI18n()
  const [data, setData] = React.useState<CardData | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    apiGet<CardData>(`/api/v1/public/card/${encodeURIComponent(token)}`)
      .then(setData)
      .catch((cause) =>
        setError(
          cause instanceof ApiError && cause.status === 400
            ? t('card.linkExpired')
            : t('card.couldNotLoad')
        )
      )
  }, [token, t])

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <p className="max-w-xs text-sm text-muted-foreground">{error}</p>
      </main>
    )
  }

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label={t('common.loading')} />
      </main>
    )
  }

  const primary = data.loyalty.programs[0]
  // Resolved through the brand kit, like the wallet pass and the join page, so
  // the browser fallback of a card is not the one surface with its own colours.
  const palette = resolveBrandPalette({
    primaryColor: data.business.primary_color,
    accentColor: data.business.accent_color,
    textColor: data.business.text_color,
  })

  async function share() {
    if (!data) return
    const url = data.customer.referral_url
    if (navigator.share) {
      await navigator.share({ title: data.business.name, url }).catch(() => undefined)
      return
    }
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="min-h-screen bg-muted/20 pb-12">
      <div className="mx-auto max-w-105 space-y-6 px-4 pt-8">
        <LoyaltyCard
          businessName={data.business.name}
          backgroundColor={palette.background}
          accentColor={palette.accent}
          textColor={palette.text}
          stampCount={primary?.goalAmount ?? 0}
          activeStamps={primary?.balance ?? 0}
          reward={data.loyalty.availableRewards[0]?.name ?? t('wallet.preview.reward')}
          logoUrl={data.business.logo_url}
          memberName={data.customer.name}
          unitLabel={primary?.unitPlural ?? t('wallet.preview.balance')}
          variant={primary?.goalAmount && primary.goalAmount <= 12 ? 'stamps' : 'balance'}
          className="w-full"
        />

        {primary?.nextTier && (
          <section className="rounded-xl border bg-card p-4">
            <Meter
              value={primary.balance}
              max={primary.balance + primary.nextTier.remaining}
              label={t('card.moreToReach', {
                count: primary.nextTier.remaining,
                tier: primary.nextTier.name,
              })}
            />
          </section>
        )}

        {data.claimable.length > 0 && (
          <section className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Gift className="size-4 text-emerald-600" aria-hidden />
              {t('card.waitingForYou')}
            </h2>
            <ul className="mt-3 space-y-2">
              {data.claimable.map((item) => (
                <li key={item.id} className="rounded-lg bg-background p-3">
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('card.showCodeAtCounter')}
                  </p>
                  <code className="mt-2 block rounded-md bg-muted px-3 py-2 text-center font-mono text-lg tracking-[0.2em]">
                    {item.code}
                  </code>
                  {item.expires_at && (
                    <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                      {t('card.validUntil', { date: formatDate(item.expires_at) })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Where to use it, and what is on offer nearby. */}
        <CustomerProximity token={token} />

        {data.gift_cards.length > 0 && (
          <section className="rounded-xl border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <CreditCard className="size-4 text-muted-foreground" aria-hidden />
              {t('card.giftCardBalance')}
            </h2>
            <ul className="mt-3 space-y-2">
              {data.gift_cards.map((card) => (
                <li key={card.code} className="rounded-lg bg-muted/50 p-3 text-center">
                  <p className="text-2xl font-semibold tabular-nums">
                    {formatCurrency(card.remaining_value, { currency: card.currency })}
                  </p>
                  <code className="mt-2 block rounded-md bg-background px-3 py-2 font-mono text-sm uppercase tracking-[0.2em]">
                    {card.code}
                  </code>
                  {card.expires_at && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      {t('card.validUntil', { date: formatDate(card.expires_at) })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.memberships.length > 0 && (
          <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
            {data.memberships.map((membership) => (
              <div key={membership.name}>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Crown className="size-4 text-amber-600 dark:text-amber-500" aria-hidden />
                  {membership.name}
                </h2>
                {membership.earn_multiplier > 1 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('card.earnMultiplier', { multiplier: membership.earn_multiplier })}
                  </p>
                )}
                {membership.perks.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {membership.perks.map((perk) => (
                      <li key={perk} className="text-xs text-muted-foreground">
                        · {perk}
                      </li>
                    ))}
                  </ul>
                )}
                {membership.renews_at && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {t('card.renews', { date: formatDate(membership.renews_at) })}
                  </p>
                )}
              </div>
            ))}
          </section>
        )}

        {data.loyalty.availableRewards.length > 0 && (
          <section className="rounded-xl border bg-card p-4">
            <h2 className="text-sm font-semibold">{t('card.rewardsYouCanEarn')}</h2>
            <ul className="mt-3 space-y-2.5">
              {data.loyalty.availableRewards.map((reward) => (
                <li key={reward.id} className="flex items-center gap-3">
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
                      reward.affordable
                        ? 'bg-emerald-500/15 text-emerald-600'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <Gift className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{reward.name}</span>
                    {reward.description && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {reward.description}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {reward.affordable
                      ? t('card.ready')
                      : `${reward.cost} ${primary?.unitPlural ?? ''}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(data.wallet.apple_available || data.wallet.google_available) && (
          <section>
            <h2 className="mb-3 text-center text-sm font-medium text-muted-foreground">
              {t('card.keepItOnYourPhone')}
            </h2>
            <WalletButtons appleUrl={data.wallet.apple} googleUrl={data.wallet.google} />
          </section>
        )}

        <section className="rounded-xl border bg-card p-4 text-center">
          <h2 className="text-sm font-semibold">{t('card.inviteAFriend')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('card.inviteBody')}</p>
          <code className="mt-3 block rounded-lg bg-muted px-3 py-2 font-mono text-lg tracking-[0.2em]">
            {data.customer.referral_code}
          </code>
          <Button variant="outline" className="mt-3 w-full gap-2" onClick={() => void share()}>
            {copied ? (
              <Check className="size-4" aria-hidden />
            ) : (
              <Share2 className="size-4" aria-hidden />
            )}
            {copied ? t('card.linkCopied') : t('card.shareInvite')}
          </Button>
        </section>

        <p className="text-center text-xs text-muted-foreground">
          {t('card.memberSinceDate', { date: formatDate(data.customer.member_since) })}
        </p>
      </div>
    </main>
  )
}
