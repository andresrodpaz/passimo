'use client'

import * as React from 'react'
import { AlertCircle, Inbox, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { ApiError } from '@/lib/client/api'
import { useI18n } from '@/lib/i18n'
import { apiErrorMessage } from '@/lib/client/api-errors'

/**
 * Shared loading / empty / error states.
 *
 * Every list and panel in the dashboard uses these, so the product never shows
 * a blank rectangle or a raw stack trace, and an empty screen always tells the
 * merchant what to do next instead of just saying "no data".
 *
 * They are also where the "never mix languages" rule is easiest to break and
 * hardest to notice: a Spanish screen that renders `Loading…` for 200 ms is
 * mixed-language, but only for the duration of a fetch, so no screenshot ever
 * catches it. Translating them here fixes it everywhere at once.
 */

export function LoadingRows({ rows = 5, className }: { rows?: number; className?: string }) {
  const { t } = useI18n()
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label={t('states.loading')}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  )
}

export function LoadingCards({ count = 4 }: { count?: number }) {
  const { t } = useI18n()
  return (
    <div
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      role="status"
      aria-label={t('states.loading')}
    >
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-xl border p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-8 w-20" />
          <Skeleton className="mt-2 h-3 w-16" />
        </div>
      ))}
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  )
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center',
        className
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown
  onRetry?: () => void
  className?: string
}) {
  const { t } = useI18n()
  const apiError = error instanceof ApiError ? error : null
  // Auth and permission failures are not "something went wrong" — say what
  // actually happened so the user can act.
  const title =
    apiError?.status === 403
      ? t('errors.forbidden')
      : apiError?.status === 404
        ? t('errors.notFound')
        : apiError?.status === 429
          ? t('states.tooManyRequests')
          : t('common.somethingWentWrong')

  // `apiErrorMessage` prefers our own translated sentence for a known error code
  // and only falls back to the server's words when we have nothing better. The
  // API has no view and therefore no locale; the merchant reading it does.
  const message = apiErrorMessage(error, t) ?? t('states.unexpected')

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-12 text-center',
        className
      )}
    >
      <AlertCircle className="size-8 text-destructive" />
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
      {onRetry && (apiError?.isRetryable ?? true) && (
        <Button variant="outline" size="sm" className="mt-5 gap-2" onClick={onRetry}>
          <RefreshCw className="size-4" />
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}

/**
 * Renders the right state for a data-fetching component in one place, so
 * individual screens stop re-implementing the same three branches.
 */
export function AsyncBoundary<T>({
  data,
  error,
  isLoading,
  onRetry,
  loading,
  empty,
  isEmpty,
  children,
}: {
  data: T | undefined
  error: unknown
  isLoading: boolean
  onRetry?: () => void
  loading?: React.ReactNode
  empty?: React.ReactNode
  isEmpty?: (data: T) => boolean
  children: (data: T) => React.ReactNode
}) {
  if (isLoading && data === undefined) return <>{loading ?? <LoadingRows />}</>
  if (error && data === undefined) return <ErrorState error={error} onRetry={onRetry} />
  if (data === undefined) return <>{loading ?? <LoadingRows />}</>
  if (isEmpty?.(data) && empty) return <>{empty}</>
  return <>{children(data)}</>
}
