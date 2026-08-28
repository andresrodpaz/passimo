'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { WorkspaceProvider, useWorkspace } from '@/lib/client/workspace'
import { EmptyState } from '@/components/states'
import { CounterScanner } from '@/components/scanner/counter-scanner'
import { useI18n } from '@/lib/i18n'

/**
 * Point of sale.
 *
 * Deliberately almost nothing: the counter scanner *is* the point of sale. There
 * is no mode to choose and no screen to navigate, because everything a till does
 * — identify a member, credit a visit, hand over a reward, take a gift card
 * payment — is a consequence of pointing the camera at something.
 *
 * Earlier versions had a search screen, a customer screen, a success screen and
 * a separate gift-card flow. Collapsing them removed three navigations from the
 * most repeated interaction in the product.
 */
export default function PosPage() {
  return (
    <WorkspaceProvider>
      <PosScreen />
    </WorkspaceProvider>
  )
}

function PosScreen() {
  const router = useRouter()
  const { t } = useI18n()
  const { businessId, can, has, loading } = useWorkspace()

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  // Viewers can look a customer up but not credit them; that is still useful at
  // a counter, so the scanner opens in identify-only mode rather than refusing.
  if (!businessId || !can('customers:read')) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <EmptyState
          title={t('pos.noAccess')}
          description={t('pos.noAccessBody')}
          action={
            <Button asChild variant="outline">
              <Link href="/dashboard">{t('pos.backToDashboard')}</Link>
            </Button>
          }
        />
      </main>
    )
  }

  return (
    // `dvh` rather than `vh`: mobile browser chrome would otherwise push the
    // footer controls off screen exactly when they are needed.
    <main className="h-dvh overflow-hidden">
      <CounterScanner
        businessId={businessId}
        canEarn={can('loyalty:earn')}
        canRedeemGiftCards={has('gift_cards') && can('loyalty:redeem')}
        onClose={() => router.push('/dashboard')}
      />
    </main>
  )
}
