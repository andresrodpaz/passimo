'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

/**
 * Apple / Google preview switch.
 *
 * A real `tablist` rather than two buttons, so it is announced as one control
 * and arrow keys move between the options — which is what a sighted mouse user
 * expects from something that looks like a segmented control, and what a screen
 * reader user needs to know the two are alternatives rather than actions.
 *
 * Extracted because four surfaces now show the same pair of previews — the card
 * designer, the brand kit, onboarding and the landing page — and a keyboard
 * behaviour implemented four times is a keyboard behaviour implemented once and
 * forgotten three times.
 */
export function PlatformSwitch({
  value,
  onChange,
  className,
  size = 'default',
}: {
  value: 'apple' | 'google'
  onChange: (value: 'apple' | 'google') => void
  className?: string
  size?: 'default' | 'sm'
}) {
  const { t } = useI18n()
  const options = ['apple', 'google'] as const

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    onChange(value === 'apple' ? 'google' : 'apple')
  }

  return (
    <div
      role="tablist"
      aria-label={t('cardDesign.preview.title')}
      onKeyDown={onKeyDown}
      className={cn('grid grid-cols-2 gap-1 rounded-lg bg-muted p-1', className)}
    >
      {options.map((option) => {
        const selected = value === option
        return (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={selected}
            // Only the selected tab is in the tab order; the arrow keys reach the
            // other one. This is the roving-tabindex pattern a tablist requires.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option)}
            className={cn(
              'rounded-md font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
              selected ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t(option === 'apple' ? 'wallet.preview.apple' : 'wallet.preview.google')}
          </button>
        )
      })}
    </div>
  )
}
