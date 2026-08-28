'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/lib/client/workspace'
import { CounterScanner } from '@/components/scanner/counter-scanner'
import { useI18n } from '@/lib/i18n'

/**
 * "Scan" — available from every screen in the dashboard.
 *
 * The scanner opens over whatever the merchant was doing and closes back onto
 * it. That is the difference between the scanner being a place you go and a
 * thing you do: a customer arriving while the owner is halfway through writing a
 * campaign should not cost them their draft.
 *
 * The camera is only mounted while the dialog is open, so no screen holds the
 * camera — or the privacy indicator — open in the background.
 */
export function ScanButton({
  className,
  label,
  size = 'sm',
}: {
  className?: string
  /** Overrides the default label. Left undefined, it follows the merchant's language. */
  label?: string
  size?: 'sm' | 'default' | 'lg'
}) {
  const [open, setOpen] = React.useState(false)
  const { businessId, can, has } = useWorkspace()
  const { t } = useI18n()

  if (!businessId || !can('customers:read')) return null

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button size={size} className={cn('gap-2', className)}>
          <ScanLine className="size-4" />
          <span className={size === 'sm' ? 'hidden sm:inline' : undefined}>{label ?? t('pos.scan')}</span>
        </Button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          // Full-bleed on a phone, a tall panel on a desktop: the same component
          // has to work on a counter tablet and on an office laptop.
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 sm:inset-y-4 sm:left-1/2 sm:h-auto sm:w-[26rem] sm:-translate-x-1/2 sm:rounded-2xl sm:border sm:shadow-2xl"
        >
          {/*
            Screen-reader only, and still user-facing text: a merchant using
            VoiceOver in Spanish must not hear the one control they use all day
            announced in English.
          */}
          <DialogPrimitive.Title className="sr-only">{t('pos.dialogTitle')}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {t('pos.dialogDescription')}
          </DialogPrimitive.Description>

          {/* Keyed on `open` so closing genuinely unmounts the camera rather than
              leaving a hidden scanner holding the device. */}
          {open && (
            <CounterScanner
              businessId={businessId}
              canEarn={can('loyalty:earn')}
              canRedeemGiftCards={has('gift_cards') && can('loyalty:redeem')}
              onClose={() => setOpen(false)}
              className="min-h-0 flex-1"
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
