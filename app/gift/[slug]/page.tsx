'use client'

import * as React from 'react'
import { use } from 'react'
import { useSearchParams } from 'next/navigation'
import { Check, Gift, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useApi, apiPost, query } from '@/lib/client/api'
import { toastError } from '@/lib/client/api-errors'
import { AsyncBoundary, EmptyState } from '@/components/states'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import { formatCurrency } from '@/lib/i18n/translate'
import { resolveBrandPalette } from '@/lib/brand/kit'
import type { TranslationKey } from '@/lib/i18n/dictionaries/en'

type ShopResponse = {
  business: {
    name: string
    slug: string
    logo_url: string | null
    cover_url: string | null
    primary_color: string | null
    accent_color: string | null
    currency: string
    city: string | null
    category: string | null
  }
  enabled: boolean
  suggested_amounts: number[]
  designs: string[]
  min_amount: number
  max_amount: number
}

/**
 * Design keys as the database stores them, mapped to translation keys.
 *
 * The stored value is `thank_you`; the dictionary nests under `thankYou`. The
 * map keeps that mismatch in one place rather than in a template string, and an
 * unknown design falls back to its raw key rather than rendering blank.
 */
const DESIGN_LABEL_KEYS: Record<string, TranslationKey> = {
  classic: 'giftShop.designs.classic',
  birthday: 'giftShop.designs.birthday',
  thank_you: 'giftShop.designs.thankYou',
  celebration: 'giftShop.designs.celebration',
  festive: 'giftShop.designs.festive',
}

/**
 * The public gift card shop.
 *
 * Optimised for one thing: a stranger who has never heard of us completing a
 * purchase on a phone in under a minute. No account, no app, one screen. Every
 * field that could be optional is optional, and the merchant's own branding
 * carries the trust — nobody is buying a gift card from "Passimo".
 */
export default function GiftShopPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <React.Suspense fallback={null}>
      <GiftShop params={params} />
    </React.Suspense>
  )
}

function GiftShop({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const { t } = useI18n()
  const searchParams = useSearchParams()
  const shop = useApi<ShopResponse>(`/api/v1/public/gift-cards${query({ slug })}`)

  const purchased = searchParams.get('purchase') === 'success'

  return (
    <main className="min-h-screen bg-muted/20 px-4 py-10">
      <div className="mx-auto max-w-lg">
        <AsyncBoundary
          data={shop.data}
          error={shop.error}
          isLoading={shop.isLoading}
          onRetry={() => void shop.mutate()}
        >
          {(data) => (
            <>
              <BusinessHeader business={data.business} />

              {purchased ? (
                <Confirmation name={data.business.name} />
              ) : data.enabled ? (
                <PurchaseForm shop={data} slug={slug} />
              ) : (
                <div className="mt-6">
                  <EmptyState
                    icon={Gift}
                    title={t('giftShop.notOnSale')}
                    description={t('giftShop.notOnSaleBody', { business: data.business.name })}
                  />
                </div>
              )}
            </>
          )}
        </AsyncBoundary>
      </div>
    </main>
  )
}

function BusinessHeader({ business }: { business: ShopResponse['business'] }) {
  const { t } = useI18n()
  // The same palette the wallet card and the join page resolve, so the monogram
  // fallback cannot end up with unreadable text on a pale brand colour.
  const palette = resolveBrandPalette({
    primaryColor: business.primary_color,
    accentColor: business.accent_color,
  })

  return (
    <header className="text-center">
      {business.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={business.logo_url}
          alt=""
          className="mx-auto size-16 rounded-2xl object-cover shadow-sm"
        />
      ) : (
        <div
          aria-hidden
          className="mx-auto flex size-16 items-center justify-center rounded-2xl text-xl font-semibold uppercase shadow-sm"
          style={{ background: palette.background, color: palette.text }}
        >
          {business.name.slice(0, 2)}
        </div>
      )}
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{business.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {business.city
          ? t('giftShop.headerCity', { city: business.city })
          : t('giftShop.header')}
      </p>
    </header>
  )
}

function Confirmation({ name }: { name: string }) {
  const { t } = useI18n()
  return (
    <section className="mt-8 rounded-2xl border bg-card p-8 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-500/10">
        <Check className="size-7 text-emerald-600 dark:text-emerald-500" />
      </div>
      <h2 className="mt-4 text-lg font-semibold">{t('giftShop.thankYou')}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t('giftShop.thankYouBody', { business: name })}
      </p>
    </section>
  )
}

function PurchaseForm({ shop, slug }: { shop: ShopResponse; slug: string }) {
  const { t, locale } = useI18n()
  /*
   * Formatted from the business's own currency. Every amount on this page was a
   * literal `€`, so a merchant charging in pounds advertised euros on the one
   * screen where a stranger hands over card details.
   */
  const price = React.useCallback(
    (value: number) => formatCurrency(value, locale, { currency: shop.business.currency }),
    [locale, shop.business.currency]
  )

  const [amount, setAmount] = React.useState(String(shop.suggested_amounts[1] ?? 25))
  const [design, setDesign] = React.useState(shop.designs[0] ?? 'classic')
  const [recipientName, setRecipientName] = React.useState('')
  const [recipientEmail, setRecipientEmail] = React.useState('')
  const [purchaserName, setPurchaserName] = React.useState('')
  const [purchaserEmail, setPurchaserEmail] = React.useState('')
  const [message, setMessage] = React.useState('')
  const [deliverOn, setDeliverOn] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const value = Number(amount) || 0
  const valid =
    value >= shop.min_amount &&
    value <= shop.max_amount &&
    recipientName.trim().length > 0 &&
    /.+@.+\..+/.test(recipientEmail) &&
    purchaserName.trim().length > 0 &&
    /.+@.+\..+/.test(purchaserEmail)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      const response = await apiPost<{ url: string | null }>('/api/v1/public/gift-cards', {
        slug,
        amount: Math.round(value),
        purchaserEmail: purchaserEmail.trim(),
        purchaserName: purchaserName.trim(),
        recipientEmail: recipientEmail.trim(),
        recipientName: recipientName.trim(),
        message: message.trim() || null,
        design,
        deliverOn: deliverOn || null,
      })
      if (response.url) window.location.assign(response.url)
      else setError(t('giftShop.paymentFailed'))
    } catch (cause) {
      /*
       * `toastError` renders our own copy for every error code we have one for
       * and only falls back to the server's sentence for codes we do not. The
       * previous `cause.message` took that English sentence *first*, which is
       * how a Spanish checkout produced an English refusal.
       */
      setError(toastError(cause, t, 'giftShop.failed'))
      setBusy(false)
    }
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <form onSubmit={submit} className="mt-8 space-y-6">
      {error && (
        <div role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-sm font-medium">{t('giftShop.howMuch')}</h2>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {shop.suggested_amounts.map((suggestion) => (
            <Button
              key={suggestion}
              type="button"
              variant={value === suggestion ? 'default' : 'outline'}
              className="h-12 text-base"
              onClick={() => setAmount(String(suggestion))}
            >
              {price(suggestion)}
            </Button>
          ))}
        </div>
        <div className="mt-3 space-y-1.5">
          <Label htmlFor="gift-amount" className="text-xs text-muted-foreground">
            {t('giftShop.orAnyAmount', {
              min: price(shop.min_amount),
              max: price(shop.max_amount),
            })}
          </Label>
          <Input
            id="gift-amount"
            type="number"
            inputMode="numeric"
            min={shop.min_amount}
            max={shop.max_amount}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="h-12 text-base"
          />
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-sm font-medium">{t('giftShop.whoFor')}</h2>
        <div className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="gift-recipient-name">{t('giftShop.theirName')}</Label>
            <Input
              id="gift-recipient-name"
              value={recipientName}
              onChange={(event) => setRecipientName(event.target.value)}
              placeholder={t('giftShop.theirNamePlaceholder')}
              className="h-12 text-base"
              autoComplete="off"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gift-recipient-email">{t('giftShop.theirEmail')}</Label>
            <Input
              id="gift-recipient-email"
              type="email"
              value={recipientEmail}
              onChange={(event) => setRecipientEmail(event.target.value)}
              placeholder={t('giftShop.theirEmailPlaceholder')}
              className="h-12 text-base"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gift-message">{t('giftShop.messageOptional')}</Label>
            <Textarea
              id="gift-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={t('giftShop.messagePlaceholder')}
              rows={2}
              maxLength={400}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gift-deliver">{t('giftShop.sendOn')}</Label>
            <Input
              id="gift-deliver"
              type="date"
              min={today}
              value={deliverOn}
              onChange={(event) => setDeliverOn(event.target.value)}
              className="h-12 text-base"
            />
            <p className="text-xs text-muted-foreground">{t('giftShop.sendOnHint')}</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-sm font-medium">{t('giftShop.whoFrom')}</h2>
        <div className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="gift-purchaser-name">{t('giftShop.yourName')}</Label>
            <Input
              id="gift-purchaser-name"
              value={purchaserName}
              onChange={(event) => setPurchaserName(event.target.value)}
              className="h-12 text-base"
              autoComplete="name"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gift-purchaser-email">{t('giftShop.yourEmail')}</Label>
            <Input
              id="gift-purchaser-email"
              type="email"
              value={purchaserEmail}
              onChange={(event) => setPurchaserEmail(event.target.value)}
              className="h-12 text-base"
              autoComplete="email"
              required
            />
            <p className="text-xs text-muted-foreground">{t('giftShop.receiptNote')}</p>
          </div>
        </div>
      </section>

      {shop.designs.length > 1 && (
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="text-sm font-medium">{t('giftShop.design')}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {shop.designs.map((option) => (
              <Button
                key={option}
                type="button"
                variant={design === option ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDesign(option)}
              >
                {DESIGN_LABEL_KEYS[option] ? t(DESIGN_LABEL_KEYS[option]) : option}
              </Button>
            ))}
          </div>
        </section>
      )}

      <Button
        type="submit"
        className={cn('h-14 w-full gap-2 text-base')}
        disabled={!valid || busy}
      >
        {busy && <Loader2 className="size-5 animate-spin" />}
        {t('giftShop.pay', { amount: price(value) })}
      </Button>

      <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" />
        {t('giftShop.stripeNote')}
      </p>
    </form>
  )
}
