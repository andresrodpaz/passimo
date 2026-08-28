'use client'

import * as React from 'react'
import { Check, Loader2, Plus, Trash2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState, ErrorState, LoadingRows } from '@/components/states'
import {
  RuleBuilder,
  draftFromRule,
  draftToPayload,
  emptyRuleDraft,
  type RuleDraft,
} from '@/components/wallet/rule-builder'
import { apiDelete, apiPatch, apiPost, useApi, query } from '@/lib/client/api'
import { useI18n } from '@/lib/i18n'
import type { RuleAction, RuleNode } from '@/lib/wallet/rules'

/**
 * The automation rules screen.
 *
 * Two ways in, on purpose. The preset gallery is for the merchant who wants "remind
 * people with a reward waiting" and does not want to think about conditions; the
 * builder is for the one who does. Presets are matched on `templateKey`, so a rule the
 * merchant has renamed still shows as added — matching on name would offer them a
 * duplicate of a rule they had customised.
 *
 * Every rule renders its generated plain-language summary, which is also what makes
 * the list scannable: a merchant reading eight rules should not have to open each one
 * to remember what it does.
 */

type Rule = {
  id: string
  name: string
  description: string | null
  isActive: boolean
  priority: number
  stopOnMatch: boolean
  conditions: RuleNode
  actions: RuleAction[]
  cooldownHours: number
  templateKey: string | null
  matchCount: number
  lastMatchedAt: string | null
  summary: string
}

type Preset = {
  templateKey: string
  industryName: string
  name: string
  description: string
  conditions: RuleNode
  actions: RuleAction[]
  cooldownHours: number
  summary: string
}

type RulesResponse = { rules: Rule[]; presets: Preset[] }
type CampaignsResponse = { campaigns: Array<{ id: string; name: string }> }

export function WalletRulesPanel({
  businessId,
  canWrite,
}: {
  businessId: string
  canWrite: boolean
}) {
  const { t, formatNumber, formatRelative } = useI18n()
  const { data, error, isLoading, mutate } = useApi<RulesResponse>(
    `/api/v1/wallet/rules${query({ businessId })}`
  )
  const { data: campaignData } = useApi<CampaignsResponse>(
    `/api/v1/wallet/campaigns${query({ businessId })}`
  )

  const [editing, setEditing] = React.useState<Rule | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)

  const rules = data?.rules ?? []
  const presets = data?.presets ?? []
  const addedTemplateKeys = new Set(rules.map((rule) => rule.templateKey).filter(Boolean))

  async function toggle(rule: Rule) {
    setBusy(rule.id)
    try {
      await apiPatch('/api/v1/wallet/rules', {
        businessId,
        id: rule.id,
        isActive: !rule.isActive,
      })
      void mutate()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('common.somethingWentWrong'))
    } finally {
      setBusy(null)
    }
  }

  async function remove(rule: Rule) {
    setBusy(rule.id)
    try {
      await apiDelete('/api/v1/wallet/rules', { businessId, id: rule.id })
      void mutate()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('common.somethingWentWrong'))
    } finally {
      setBusy(null)
    }
  }

  async function addPreset(preset: Preset) {
    setBusy(preset.templateKey)
    try {
      await apiPost('/api/v1/wallet/rules', {
        businessId,
        name: preset.name,
        description: preset.description,
        // Presets arrive switched off, like template campaigns: the merchant reads
        // what will reach their customers before it does.
        isActive: false,
        conditions: preset.conditions,
        actions: preset.actions,
        cooldownHours: preset.cooldownHours,
        templateKey: preset.templateKey,
      })
      toast.success(t('wallet.rules.added'))
      void mutate()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('common.somethingWentWrong'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{t('wallet.rules.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('wallet.rules.subtitle')}</p>
        </div>
        {canWrite && (
          <Button onClick={() => setCreating(true)} className="gap-2">
            <Plus className="size-4" aria-hidden />
            {t('wallet.rules.create')}
          </Button>
        )}
      </div>

      {isLoading && <LoadingRows rows={3} />}
      {error && <ErrorState error={error} onRetry={() => void mutate()} />}

      {!isLoading && !error && rules.length === 0 && (
        <EmptyState
          icon={Zap}
          title={t('wallet.rules.empty')}
          description={t('wallet.rules.emptyBody')}
        />
      )}

      {rules.length > 0 && (
        <ul className="space-y-3">
          {rules.map((rule) => (
            <li key={rule.id}>
              <article className="rounded-2xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold">{rule.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{rule.summary}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {canWrite ? (
                      <>
                        <Switch
                          checked={rule.isActive}
                          disabled={busy === rule.id}
                          onCheckedChange={() => toggle(rule)}
                          aria-label={t('common.active')}
                        />
                        <Button variant="outline" size="sm" onClick={() => setEditing(rule)}>
                          {t('common.edit')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 text-muted-foreground"
                          onClick={() => remove(rule)}
                          disabled={busy === rule.id}
                          aria-label={t('common.delete')}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      </>
                    ) : (
                      <Badge variant={rule.isActive ? 'secondary' : 'outline'}>
                        {rule.isActive ? t('common.active') : t('common.inactive')}
                      </Badge>
                    )}
                  </div>
                </div>

                <p className="mt-3 text-xs text-muted-foreground">
                  {rule.matchCount > 0
                    ? t('wallet.rules.matched', { count: rule.matchCount })
                    : t('wallet.rules.neverMatched')}
                  {rule.lastMatchedAt && (
                    <>
                      {' · '}
                      {t('wallet.rules.lastMatched', { when: formatRelative(rule.lastMatchedAt) })}
                    </>
                  )}
                  {' · '}
                  {t('wallet.rules.priority')} {formatNumber(rule.priority)}
                </p>
              </article>
            </li>
          ))}
        </ul>
      )}

      {/* Preset gallery */}
      {canWrite && presets.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold">{t('wallet.rules.presets')}</h3>
          <ul className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {presets.map((preset) => {
              const added = addedTemplateKeys.has(preset.templateKey)
              return (
                <li key={preset.templateKey}>
                  <article className="flex h-full flex-col rounded-2xl border bg-card p-4">
                    <h4 className="text-sm font-semibold">{preset.name}</h4>
                    <p className="mt-1 flex-1 text-xs text-muted-foreground">{preset.summary}</p>
                    <Button
                      variant={added ? 'ghost' : 'outline'}
                      size="sm"
                      className="mt-3 w-full gap-1.5"
                      disabled={added || busy === preset.templateKey}
                      onClick={() => addPreset(preset)}
                    >
                      {busy === preset.templateKey ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : added ? (
                        <Check className="size-3.5" aria-hidden />
                      ) : (
                        <Plus className="size-3.5" aria-hidden />
                      )}
                      {added ? t('wallet.rules.added') : t('wallet.rules.addPreset')}
                    </Button>
                  </article>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <RuleDialog
        key={editing?.id ?? (creating ? 'new' : 'closed')}
        open={creating || editing !== null}
        businessId={businessId}
        rule={editing}
        campaigns={campaignData?.campaigns ?? []}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={() => {
          setCreating(false)
          setEditing(null)
          void mutate()
        }}
      />
    </div>
  )
}

function RuleDialog({
  open,
  businessId,
  rule,
  campaigns,
  onClose,
  onSaved,
}: {
  open: boolean
  businessId: string
  rule: Rule | null
  campaigns: Array<{ id: string; name: string }>
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = React.useState<RuleDraft>(() =>
    rule ? draftFromRule(rule) : emptyRuleDraft()
  )
  const [saving, setSaving] = React.useState(false)

  async function save() {
    if (!draft.name.trim()) return
    setSaving(true)
    try {
      const payload = { businessId, ...draftToPayload(draft) }
      if (rule) {
        await apiPatch('/api/v1/wallet/rules', { ...payload, id: rule.id })
      } else {
        await apiPost('/api/v1/wallet/rules', payload)
      }
      toast.success(t('common.saved'))
      onSaved()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('common.somethingWentWrong'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule ? t('wallet.rules.edit') : t('wallet.rules.create')}</DialogTitle>
          <DialogDescription>{t('wallet.rules.subtitle')}</DialogDescription>
        </DialogHeader>

        <RuleBuilder draft={draft} onChange={setDraft} campaigns={campaigns} />

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save} disabled={saving || !draft.name.trim()} className="gap-2">
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
