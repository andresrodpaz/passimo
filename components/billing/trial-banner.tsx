'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AlertTriangle, ArrowRight, Clock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/lib/client/workspace'
import { useStoredValue } from '@/lib/client/hooks'
import { useI18n } from '@/lib/i18n'
import { ENTRY_PLAN, PLANS, PLAN_CURRENCY } from '@/lib/billing/plans'

/**
 * The one persistent billing message, at the top of the dashboard.
 *
 * Rules that keep it from becoming wallpaper:
 *
 *  - It only appears when there is something to *do*: a trial ending, a failed
 *    payment, a cancellation pending. A banner that is always there is a banner
 *    nobody reads.
 *  - Urgency escalates. Ten days out it is a quiet note; three days out it is
 *    prominent; a failed payment is never dismissible, because ignoring it
 *    costs the merchant their account.
 *  - Dismissal is remembered per state, not forever — dismissing "11 days left"
 *    should not hide "2 days left".
 *  - It is hidden on the billing page itself, where it would be redundant.
 */
export function TrialBanner() {
  const { entitlements, can } = useWorkspace()
  const pathname = usePathname()
  const [dismissed, setDismissed] = useStoredValue('passimo.billingNoticeDismissed')
  const i18n = useI18n()

  if (!entitlements || pathname?.startsWith('/dashboard/billing')) return null

  const notice = resolveNotice(entitlements, i18n)
  if (!notice) return null
  if (notice.dismissible && dismissed === notice.key) return null

  return (
    <div
      role={notice.severity === 'critical' ? 'alert' : 'status'}
      className={cn(
        'mb-5 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3',
        notice.severity === 'critical'
          ? 'border-destructive/40 bg-destructive/10'
          : notice.severity === 'warning'
            ? 'border-amber-500/40 bg-amber-500/10'
            : 'border-primary/30 bg-primary/[0.06]'
      )}
    >
      {notice.severity === 'critical' ? (
        <AlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden />
      ) : (
        <Clock
          className={cn(
            'size-5 shrink-0',
            notice.severity === 'warning' ? 'text-amber-600 dark:text-amber-500' : 'text-primary'
          )}
          aria-hidden
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{notice.title}</p>
        <p className="text-sm text-muted-foreground">{notice.body}</p>
      </div>

      {can('billing:manage') && (
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/dashboard/billing">
            {notice.cta}
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      )}

      {notice.dismissible && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={() => setDismissed(notice.key)}
          aria-label={i18n.t('dashboard.billingNotice.dismiss')}
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  )
}

type Notice = {
  key: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  body: string
  cta: string
  dismissible: boolean
}

function resolveNotice(
  entitlements: NonNullable<ReturnType<typeof useWorkspace>['entitlements']>,
  { t, formatCurrency, formatDate }: ReturnType<typeof useI18n>
): Notice | null {
  const { trial, subscription, effective_plan } = entitlements

  // A card we cannot charge is the most urgent state there is, and never
  // dismissible — ignoring it ends with the merchant losing their plan.
  if (subscription.delinquent) {
    return {
      key: 'delinquent',
      severity: 'critical',
      title: t('dashboard.billingNotice.delinquentTitle'),
      body: t('dashboard.billingNotice.delinquentBody'),
      cta: t('dashboard.billingNotice.delinquentCta'),
      dismissible: false,
    }
  }

  if (subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd) {
    return {
      key: `cancelling:${subscription.currentPeriodEnd}`,
      severity: 'warning',
      title: t('dashboard.billingNotice.cancellingTitle', {
        // The merchant's own locale formats the date. `toLocaleDateString` with
        // no locale argument used the *browser's*, which is not necessarily the
        // language the rest of the banner is in.
        date: formatDate(subscription.currentPeriodEnd, { day: 'numeric', month: 'long' }),
      }),
      body: t('dashboard.billingNotice.cancellingBody'),
      cta: t('dashboard.billingNotice.cancellingCta'),
      dismissible: true,
    }
  }

  if (trial.active) {
    const days = trial.daysRemaining
    const planName = PLANS[effective_plan].name

    if (days <= 3) {
      return {
        key: `trial:${days}`,
        severity: 'warning',
        title:
          days <= 0
            ? t('dashboard.billingNotice.endsToday')
            : t('dashboard.billingNotice.endsInDays', { count: days }),
        /*
         * States what actually happens: the workspace lapses, every row stays,
         * and reactivating is one click. It does not name a free plan, because
         * there is no free plan to move to.
         */
        body: t('dashboard.billingNotice.endingBody', { plan: planName }),
        cta: t('dashboard.billingNotice.endingCta'),
        dismissible: false,
      }
    }

    if (days <= 10) {
      return {
        key: `trial:${days}`,
        severity: 'info',
        title: t('dashboard.billingNotice.daysLeft', { count: days }),
        body: t('dashboard.billingNotice.trialBody', {
          plan: planName,
          price: formatCurrency(ENTRY_PLAN.monthlyPrice ?? 0, { currency: PLAN_CURRENCY }),
        }),
        cta: t('dashboard.billingNotice.trialCta'),
        dismissible: true,
      }
    }
  }

  return null
}
