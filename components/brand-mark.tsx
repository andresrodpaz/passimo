import { cn } from '@/lib/utils'

/** The Passimo mark. One component so the logo is identical everywhere. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm',
        className
      )}
    >
      <svg viewBox="0 0 24 24" className="size-1/2" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20V6a2 2 0 0 1 2-2h12" />
        <path d="M4 12h11" />
        <circle cx="17" cy="16" r="4" />
      </svg>
    </span>
  )
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <BrandMark />
      <span className="text-lg font-semibold tracking-tight">Passimo</span>
    </span>
  )
}
