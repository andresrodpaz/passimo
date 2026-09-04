'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Rocket, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Meter } from '@/components/metrics'
import { useApi, apiPatch, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { useI18n } from '@/lib/i18n'
import { resolveChecklist, type ChecklistFacts } from '@/lib/onboarding/checklist'

/**
 * The first-steps checklist.
 *
 * This is the other half of the onboarding change: the wizard stopped asking for
 * six things, so the three it dropped have to be visible somewhere a merchant
 * will actually see them. Deliberately *not* a new notification system — it
 * reuses the existing card, meter and button primitives and one small endpoint,
 * because a second inbox is a second thing to build, maintain and ignore.
 *
 * Three rules:
 *
 *  1. **It never blocks.** No modal, no interstitial, no "finish setup to
 *     continue". It sits above the metrics and can be gone in one click.
 *  2. **Dismissal is permanent and portable.** A row, not `localStorage`, so
 *     hiding it on the laptop hides it on the phone at the counter too.
 *  3. **It retires itself.** When every visible item is done the card disappears
 *     without being dismissed, because a checklist of ticks is clutter.
 */
export function FirstStepsChecklist() {
  const { businessId, has, can } = useWorkspace()
  const { t } = useI18n()
  const [hidden, setHidden] = React.useState(false)

  const { data, mutate } = useApi<{ dismissed: boolean; facts: ChecklistFacts }>(
    businessId ? `/api/v1/onboarding${query({ businessId })}` : null
  )

  const state = React.useMemo(
    () => (data ? resolveChecklist(data.facts, has) : null),
    [data, has]
  )

  // Nothing renders until the answer is known: a checklist that appears a beat
  // after the page is a layout shift on the screen merchants open most.
  if (!data || !state || hidden || data.dismissed || state.complete || state.total === 0) {
    return null
  }

  async function dismiss() {
    // Hidden immediately, persisted in the background. If the write fails the
    // card returns on the next load, which is the right way round for something
    // this small — nothing is lost either way.
    setHidden(true)
    if (!businessId) return
    try {
      await apiPatch('/api/v1/onboarding', { businessId, checklistDismissed: true })
      void mutate()
    } catch {
      setHidden(false)
    }
  }

  return (
    // Named, so it is announced as a landmark rather than an anonymous
    // `<section>` — which is what an unnamed one is, to a screen reader and to a
    // role-based test alike.
    <section
      aria-labelledby="first-steps-title"
      className="rounded-xl border border-primary/25 bg-linear-to-br from-primary/[0.06] via-card to-card p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Rocket className="size-4" aria-hidden />
          </span>
          <div>
            <h2 id="first-steps-title" className="text-base font-semibold">
              {t('checklist.title')}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('checklist.subtitle')}</p>
          </div>
        </div>

        {can('settings:write') && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={() => void dismiss()}
            aria-label={t('checklist.dismiss')}
          >
            <X className="size-4" />
          </Button>
        )}
      </header>

      <Meter
        className="mt-4"
        value={state.done}
        max={state.total}
        label={t('checklist.progress', { done: state.done, total: state.total })}
        tone={state.done === state.total ? 'success' : 'default'}
      />

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {state.items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className={`flex items-start gap-3 rounded-lg border p-3 transition-colors hover:border-primary/50 ${
                item.done ? 'opacity-60' : 'bg-card'
              }`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${
                  item.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-muted-foreground/40'
                }`}
              >
                {item.done && <Check className="size-3" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-medium ${item.done ? 'line-through' : ''}`}>
                  {t(item.titleKey)}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t(item.bodyKey)}
                </span>
              </span>
              {!item.done && (
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
