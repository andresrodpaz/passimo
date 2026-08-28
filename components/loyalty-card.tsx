'use client'

import * as React from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { meetsContrastAA, normalizeHex, readableTextOn } from '@/lib/wallet/card-design'

/**
 * The loyalty card.
 *
 * Shown on the join page, the customer's card page and the branding editor —
 * one component so the preview a merchant designs is exactly what the customer
 * sees.
 *
 * Legibility is enforced rather than trusted, but it is enforced through the
 * *same* functions the wallet pass builder uses. This file used to carry its own
 * `readableOn`, which was the third copy of a formula that claimed WCAG
 * luminance while computing an unweighted channel average with no gamma
 * correction and thresholding at 0.6. Three copies meant three verdicts: the
 * same brand colour could yield white text on the installed pass and dark text
 * on the join page that advertised it.
 *
 * The rule is now identical to `resolveBrandPalette`'s: a supplied text colour
 * is honoured when it actually passes AA against the background, and recomputed
 * when it does not. That matters because callers now pass an already-resolved
 * palette — recomputing unconditionally would discard a merchant's legible
 * choice for one this component happened to prefer.
 */

interface LoyaltyCardProps {
  businessName: string
  backgroundColor: string
  accentColor: string
  textColor: string
  /** Total needed to complete the card. */
  stampCount: number
  activeStamps: number
  reward: string
  logoUrl?: string | null
  fontFamily?: string
  /** Points/cashback programs show a number instead of a stamp grid. */
  variant?: 'stamps' | 'balance'
  unitLabel?: string
  memberName?: string | null
  className?: string
}

/**
 * A text colour guaranteed readable on `background`.
 *
 * `preferred` is kept only when it clears AA; otherwise black or white is
 * computed from the background. An unparseable background falls back to the
 * preferred colour, then to white — a card must still render.
 */
function legibleOn(background: string, preferred?: string | null): string {
  const bg = normalizeHex(background)
  const chosen = normalizeHex(preferred)

  if (!bg) return chosen ?? '#ffffff'
  return chosen && meetsContrastAA(chosen, bg) ? chosen : readableTextOn(bg)
}

export function LoyaltyCard({
  businessName,
  backgroundColor,
  accentColor,
  textColor,
  stampCount,
  activeStamps,
  reward,
  logoUrl,
  fontFamily = 'Inter',
  variant = 'stamps',
  unitLabel = 'stamps',
  memberName,
  className,
}: LoyaltyCardProps) {
  const foreground = legibleOn(backgroundColor, textColor)
  // Nothing is "preferred" on the accent — the badge sits on the merchant's
  // accent colour and only black or white can be guaranteed against it. The old
  // code fell back to the card background here, which is not required to
  // contrast with the accent at all.
  const onAccent = legibleOn(accentColor)

  // A 40-slot grid is unreadable; past 12 the card switches to a counter.
  const useGrid = variant === 'stamps' && stampCount > 0 && stampCount <= 12
  const remaining = Math.max(0, stampCount - activeStamps)
  const complete = stampCount > 0 && activeStamps >= stampCount

  return (
    <div
      className={cn(
        'relative aspect-[1.586/1] w-full max-w-sm overflow-hidden rounded-2xl p-5 shadow-xl',
        className
      )}
      style={{ backgroundColor, color: foreground, fontFamily }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-black/20"
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {logoUrl ? (
            <div className="size-10 shrink-0 overflow-hidden rounded-lg bg-white/20">
              <Image
                src={logoUrl}
                alt=""
                width={40}
                height={40}
                unoptimized
                className="size-full object-cover"
              />
            </div>
          ) : (
            <div
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-lg text-lg font-bold"
              style={{ backgroundColor: accentColor, color: onAccent }}
            >
              {businessName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold leading-tight">{businessName}</h3>
            <p className="truncate text-xs opacity-70">
              {memberName ? memberName : 'Loyalty card'}
            </p>
          </div>
        </div>

        {complete && (
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
            style={{ backgroundColor: accentColor, color: onAccent }}
          >
            Ready
          </span>
        )}
      </div>

      {useGrid ? (
        <div
          className="relative mt-4 flex flex-wrap justify-center gap-2"
          role="img"
          aria-label={`${activeStamps} of ${stampCount} ${unitLabel} collected`}
        >
          {Array.from({ length: stampCount }, (_, index) => {
            const filled = index < activeStamps
            return (
              <span
                key={index}
                aria-hidden
                className={cn(
                  'flex size-8 items-center justify-center rounded-full border-2 transition-all',
                  filled ? 'scale-100' : 'scale-95 opacity-50'
                )}
                style={{
                  borderColor: accentColor,
                  backgroundColor: filled ? accentColor : 'transparent',
                }}
              >
                {filled && (
                  <svg className="size-4" style={{ color: onAccent }} fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </span>
            )
          })}
        </div>
      ) : (
        <div className="relative mt-5 text-center">
          <p className="text-4xl font-bold tabular-nums" style={{ color: accentColor }}>
            {activeStamps}
            {stampCount > 0 && (
              <span className="text-xl opacity-60"> / {stampCount}</span>
            )}
          </p>
          <p className="mt-0.5 text-xs uppercase tracking-wide opacity-70">{unitLabel}</p>
        </div>
      )}

      <div className="absolute inset-x-5 bottom-4 text-center">
        <p className="text-[11px] uppercase tracking-wide opacity-70">
          {complete
            ? 'Claim on your next visit'
            : remaining > 0 && stampCount > 0
              ? `${remaining} more for`
              : 'Your reward'}
        </p>
        <p className="mt-0.5 truncate font-semibold" style={{ color: accentColor }}>
          {reward}
        </p>
      </div>
    </div>
  )
}
