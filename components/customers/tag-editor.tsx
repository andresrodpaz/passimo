'use client'

import * as React from 'react'
import { Plus, Tag as TagIcon, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiPatch } from '@/lib/client/api'
import { toastError } from '@/lib/client/api-errors'
import { useI18n } from '@/lib/i18n'

export type CustomerTag = { id: string; name: string; color?: string | null }

/**
 * Tagging a customer who is already a customer.
 *
 * The gap this closes: tags could only be written *at enrolment* or through a
 * CSV column. The profile rendered them as read-only badges, the customer list
 * accepted a `?tag=` filter nothing in the UI could set, and segments offered a
 * "Tag is one of" condition a merchant had no way to populate. Three features
 * resting on a write path that closed the moment somebody became a customer —
 * so a café owner could not mark the regular in front of them as "wholesale" or
 * "no nuts", which is most of what tagging is for.
 *
 * Deliberately not a combobox. Tagging happens with a customer standing at the
 * counter, so the interaction is: read the chips, press ×, type a word, press
 * Enter. Existing tags are offered as one-tap suggestions because re-typing
 * "wholesale" slightly differently is how a tag list becomes useless — and the
 * server folds case for the same reason.
 */
export function TagEditor({
  businessId,
  customerId,
  tags,
  suggestions = [],
  editable,
  onChange,
}: {
  businessId: string
  customerId: string
  tags: readonly CustomerTag[]
  /** Tags this business already uses, offered as one-tap additions. */
  suggestions?: readonly string[]
  editable: boolean
  onChange: () => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [adding, setAdding] = React.useState(false)

  const current = React.useMemo(() => tags.map((tag) => tag.name), [tags])

  /*
   * The whole set is sent every time, because the endpoint replaces rather than
   * appends. An append-only endpoint cannot express "remove this one", which is
   * how a tag editor quietly becomes a tag adder.
   */
  async function commit(next: string[]) {
    setBusy(true)
    try {
      await apiPatch(`/api/v1/customers/${customerId}`, { businessId, tags: next })
      onChange()
    } catch (cause) {
      toast.error(toastError(cause, t, 'customers.tags.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  function add(name: string) {
    const value = name.trim()
    if (!value) return
    // Case-insensitive, matching the server, so the merchant is not told a tag
    // was added and then shown the one they already had.
    if (current.some((tag) => tag.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      setDraft('')
      return
    }
    setDraft('')
    void commit([...current, value])
  }

  const unused = suggestions.filter(
    (name) => !current.some((tag) => tag.toLocaleLowerCase() === name.toLocaleLowerCase())
  )

  if (!editable && current.length === 0) return null

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <TagIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />

        {tags.map((tag) => (
          <Badge
            key={tag.id}
            variant="secondary"
            className="gap-1 pr-1"
            style={tag.color ? { borderColor: tag.color } : undefined}
          >
            {tag.name}
            {editable && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void commit(current.filter((name) => name !== tag.name))}
                aria-label={t('customers.tags.remove', { tag: tag.name })}
                className="rounded-full p-0.5 transition-colors hover:bg-foreground/10 disabled:opacity-50"
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </Badge>
        ))}

        {current.length === 0 && !adding && (
          <span className="text-xs text-muted-foreground">{t('customers.tags.none')}</span>
        )}

        {editable && !adding && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-xs"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-3" aria-hidden />
            {t('customers.tags.add')}
          </Button>
        )}
      </div>

      {editable && adding && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-2">
            <Input
              autoFocus
              value={draft}
              maxLength={60}
              disabled={busy}
              placeholder={t('customers.tags.placeholder')}
              aria-label={t('customers.tags.add')}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  add(draft)
                }
                if (event.key === 'Escape') {
                  setDraft('')
                  setAdding(false)
                }
              }}
              className="h-9 max-w-56"
            />
            <Button size="sm" className="h-9" disabled={busy || !draft.trim()} onClick={() => add(draft)}>
              {t('common.add')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9"
              disabled={busy}
              onClick={() => {
                setDraft('')
                setAdding(false)
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>

          {unused.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                {t('customers.tags.reuse')}
              </span>
              {unused.slice(0, 8).map((name) => (
                <Button
                  key={name}
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={busy}
                  onClick={() => add(name)}
                >
                  {name}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
