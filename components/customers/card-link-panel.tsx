'use client'

import * as React from 'react'
import { Check, Copy, ExternalLink, Link2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { JoinQr } from '@/components/join/join-qr'
import { apiGet, apiPost, query } from '@/lib/client/api'
import { toastError } from '@/lib/client/api-errors'
import { useI18n } from '@/lib/i18n'

/**
 * The customer's card link, and the button that invalidates it.
 *
 * This exists because the link is a bearer credential and the card behind it
 * carries gift-card balances and redemption codes — so "I think someone else
 * has my card link" is a question a merchant will eventually be asked, and
 * until now the only answer was to erase the customer.
 *
 * The link is fetched on demand rather than arriving with the profile. Every
 * customer page load would otherwise put a working credential into a response
 * nobody had asked for, and into whatever caches sit in front of it. A merchant
 * who wants the link clicks for it.
 *
 * The confirmation copy is deliberately specific about what rotation does *not*
 * do. An installed wallet pass keeps working — it authenticates with a separate
 * token — so telling a merchant "the card is revoked" would be the dangerous
 * kind of reassuring.
 */

type Props = {
  businessId: string
  customerId: string
  /** False for roles without `customers:write`; the link stays readable. */
  editable: boolean
}

export function CardLinkPanel({ businessId, customerId, editable }: Props) {
  const { t } = useI18n()
  const [url, setUrl] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [rotated, setRotated] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const endpoint = `/api/v1/customers/${customerId}/card-link${query({ businessId })}`

  async function reveal() {
    setBusy(true)
    setError(null)
    try {
      const result = await apiGet<{ card_url: string }>(endpoint)
      setUrl(result.card_url)
    } catch (cause) {
      setError(toastError(cause, t, 'customers.profile.cardLinkFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function rotate() {
    setBusy(true)
    setError(null)
    setConfirming(false)
    try {
      const result = await apiPost<{ card_url: string }>(endpoint, {})
      setUrl(result.card_url)
      setRotated(true)
      setCopied(false)
    } catch (cause) {
      setError(toastError(cause, t, 'customers.profile.cardLinkRotateFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <Link2 className="size-4 text-muted-foreground" aria-hidden />
        {t('customers.profile.cardLink')}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('customers.profile.cardLinkBody')}</p>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-destructive/10 p-2.5 text-sm text-destructive">
          {error}
        </p>
      )}

      {rotated && (
        <p
          role="status"
          className="mt-3 rounded-lg bg-emerald-500/10 p-2.5 text-sm text-emerald-700 dark:text-emerald-400"
        >
          {t('customers.profile.cardLinkRotated')}
        </p>
      )}

      {url ? (
        <div className="mt-4 space-y-3">
          <div className="flex gap-2">
            <Input readOnly value={url} className="font-mono text-xs" />
            <Button
              variant="outline"
              size="icon"
              aria-label={t('common.copy')}
              onClick={() => {
                void navigator.clipboard.writeText(url)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>

          <div className="flex flex-wrap items-start gap-4">
            <JoinQr joinUrl={url} size={120} renderSize={512} alt={t('customers.profile.cardQrAlt')} />
            <div className="flex flex-col gap-2">
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <a href={url} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" />
                  {t('common.preview')}
                </a>
              </Button>
              {editable && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                >
                  <RefreshCw className="size-3.5" />
                  {t('customers.profile.cardLinkRotate')}
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="mt-4" disabled={busy} onClick={() => void reveal()}>
          {t('customers.profile.cardLinkShow')}
        </Button>
      )}

      <AlertDialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('customers.profile.cardLinkRotate')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('customers.profile.cardLinkRotateConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void rotate()}>
              {t('customers.profile.cardLinkRotate')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
