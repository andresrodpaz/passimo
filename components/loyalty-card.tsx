'use client'

import * as React from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'

/**
 * The loyalty card.
 *
 * Shown on the join page, the customer's card page and the branding editor —
 * one component so the preview a merchant designs is exactly what the customer
 * sees. Text colour is derived from the background rather than trusted, so a
 * merchant can never accidentally configure an unreadable card.
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

function readableOn(hex: string, fallback: string): string {
  const value = hex?.replace('#', '') ?? ''
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return fallback
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? '#111827' : '#ffffff'
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
  const foreground = readableOn(backgroundColor, textColor)
  const onAccent = readableOn(accentColor, backgroundColor)

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
