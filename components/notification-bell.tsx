'use client'

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, Bell, Check, CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useApi, apiPost, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { useRelativeTime } from '@/lib/client/hooks'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type Notification = {
  id: string
  kind: string
  title: string
  body: string | null
  url: string | null
  severity: 'info' | 'success' | 'warning' | 'critical'
  read_at: string | null
  created_at: string
}

/**
 * The notification bell.
 *
 * Notifications were being written by automations and the billing webhook but
 * had nowhere to appear, so "an unhappy customer needs you" was invisible until
 * someone happened to open the right screen.
 *
 * Fetched only when opened — a badge count already comes down with `/me`, and
 * polling a feed nobody looks at is a request per merchant per minute for
 * nothing.
 */
export function NotificationBell() {
  const { businessId, unreadNotifications, refresh } = useWorkspace()
  const { t } = useI18n()
  const [open, setOpen] = React.useState(false)
  const relative = useRelativeTime()

  const feed = useApi<{ notifications: Notification[]; unread: number }>(
    open && businessId ? `/api/v1/notifications${query({ businessId, limit: 20 })}` : null
  )

  const unread = feed.data?.unread ?? unreadNotifications

  async function markAllRead() {
    if (!businessId) return
    await apiPost('/api/v1/notifications', { businessId })
    await feed.mutate()
    refresh()
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unread > 0
              ? t('dashboard.notifications.labelUnread', { count: unread })
              : t('dashboard.notifications.label')
          }
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <p className="text-sm font-semibold">{t('dashboard.notifications.title')}</p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => void markAllRead()}
            >
              <CheckCheck className="size-3.5" />
              {t('dashboard.notifications.markAllRead')}
            </Button>
          )}
        </div>

        <div className="max-h-[380px] overflow-y-auto">
          {feed.isLoading && !feed.data ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {t('common.loading')}
            </p>
          ) : (feed.data?.notifications ?? []).length === 0 ? (
            <div className="px-3 py-10 text-center">
              <Check className="mx-auto size-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                {t('dashboard.notifications.empty')}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {(feed.data?.notifications ?? []).map((notification) => {
                const content = (
                  <>
                    <div className="flex items-start gap-2">
                      {notification.severity === 'critical' ||
                      notification.severity === 'warning' ? (
                        <AlertTriangle
                          className={cn(
                            'mt-0.5 size-4 shrink-0',
                            notification.severity === 'critical'
                              ? 'text-destructive'
                              : 'text-amber-600 dark:text-amber-500'
                          )}
                          aria-hidden
                        />
                      ) : null}
                      <p className="flex-1 text-sm font-medium leading-snug">
                        {notification.title}
                      </p>
                      {!notification.read_at && (
                        <span
                          aria-label={t('dashboard.notifications.unread')}
                          className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                        />
                      )}
                    </div>
                    {notification.body && (
                      <p className="mt-1 text-xs text-muted-foreground">{notification.body}</p>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {relative(notification.created_at, { short: true })}
                    </p>
                  </>
                )

                return (
                  <li key={notification.id}>
                    {notification.url ? (
                      <Link
                        href={notification.url}
                        onClick={() => setOpen(false)}
                        className={cn(
                          'block px-3 py-2.5 transition-colors hover:bg-accent',
                          !notification.read_at && 'bg-primary/[0.04]'
                        )}
                      >
                        {content}
                      </Link>
                    ) : (
                      <div
                        className={cn('px-3 py-2.5', !notification.read_at && 'bg-primary/[0.04]')}
                      >
                        {content}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
