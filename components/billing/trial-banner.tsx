'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AlertTriangle, ArrowRight, Clock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/lib/client/workspace'
import { useStoredValue } from '@/lib/client/hooks'
import { PLANS } from '@/lib/billing/plans'

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

  if (!entitlements || pathname?.startsWith('/dashboard/billing')) return null

  const notice = resolveNotice(entitlements)
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
          aria-label="Dismiss"
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
  entitlements: NonNullable<ReturnType<typeof useWorkspace>['entitlements']>
): Notice | null {
  const { trial, subscription, effective_plan } = entitlements

  // A card we cannot charge is the most urgent state there is, and never
  // dismissible — ignoring it ends with the merchant losing their plan.
  if (subscription.delinquent) {
    return {
      key: 'delinquent',
      severity: 'critical',
      title: 'We could not take your payment',
      body: 'Update your card to keep your plan. Your customers and history are safe either way.',
      cta: 'Fix payment',
      dismissible: false,
    }
  }

  if (subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd) {
    const endsAt = new Date(subscription.currentPeriodEnd)
    return {
      key: `cancelling:${subscription.currentPeriodEnd}`,
      severity: 'warning',
      title: `Your plan ends on ${endsAt.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`,
      body: 'Change your mind any time before then and nothing is interrupted.',
      cta: 'Keep my plan',
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
          days <= 1
            ? 'Your trial ends today'
            : `Your trial ends in ${days} days`,
        body: `Pick a plan to keep ${planName} features. Nothing is deleted if you do not — you simply move to Free.`,
        cta: 'Choose a plan',
        dismissible: false,
      }
    }

    if (days <= 10) {
      return {
        key: `trial:${days}`,
        severity: 'info',
        title: `${days} days left on your trial`,
        body: `You are on ${planName} with everything switched on. No card needed until it ends.`,
        cta: 'See plans',
        dismissible: true,
      }
    }
  }

  return null
}
