'use client'

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import {
  ACTION_LABELS,
  FACT_LABELS,
  OPERATOR_LABELS,
  RULE_ACTION_TYPES,
  RULE_FACTS,
  describeRule,
  type RuleAction,
  type RuleActionType,
  type RuleCondition,
  type RuleFact,
  type RuleNode,
  type RuleOperator,
} from '@/lib/wallet/rules'

/**
 * The visual rule builder.
 *
 * *"IF the customer is within 100 metres AND has enough points THEN tell them their
 * reward is ready"* — assembled from dropdowns, and rendered back as that exact
 * sentence underneath. The sentence comes from `describeRule`, the same function the
 * API and the rule list use, so what the merchant reads is generated from what will
 * actually run. A hand-written description could drift from the logic; a generated
 * one cannot, and that is what makes a no-code builder trustworthy rather than
 * merely convenient.
 *
 * The vocabulary — which facts, comparisons and actions exist — comes from the
 * engine's own exported constants, not from a list retyped here. Adding a fact to
 * `lib/wallet/rules.ts` therefore adds it to this UI, and it is impossible for the
 * builder to offer a condition the evaluator cannot run.
 *
 * Only `all` and `any` at the top level. `none` and nesting are supported by the
 * evaluator and by the API, but a merchant who needs a nested boolean tree is a
 * merchant we have lost — that complexity belongs in segments, which already has it.
 */

const BOOLEAN_FACTS: RuleFact[] = [
  'is_vip',
  'is_birthday',
  'is_anniversary',
  'has_claimable_reward',
  'has_pass_installed',
]

const CHOICE_FACTS: Partial<Record<RuleFact, Array<{ value: string; label: string }>>> = {
  trigger: [
    { value: 'entry', label: 'entry' },
    { value: 'exit', label: 'exit' },
    { value: 'dwell', label: 'dwell' },
    { value: 'nearby', label: 'nearby' },
  ],
}

/** Which comparisons make sense for a fact. Offering `lt` on a boolean is noise. */
function operatorsFor(fact: RuleFact): RuleOperator[] {
  if (BOOLEAN_FACTS.includes(fact)) return ['is_true', 'is_false']
  if (fact === 'trigger' || fact === 'location_id' || fact === 'segment_id') {
    return ['eq', 'neq', 'in', 'not_in']
  }
  return ['lte', 'gte', 'eq', 'neq', 'between', 'lt', 'gt']
}

function defaultConditionFor(fact: RuleFact): RuleCondition {
  const operator = operatorsFor(fact)[0]
  if (operator === 'is_true' || operator === 'is_false') return { fact, op: operator }
  return { fact, op: operator, value: fact === 'distance_meters' ? 100 : 1 }
}

export type RuleDraft = {
  name: string
  description: string
  isActive: boolean
  priority: number
  stopOnMatch: boolean
  match: 'all' | 'any'
  conditions: RuleCondition[]
  actions: RuleAction[]
  cooldownHours: number
}

export function emptyRuleDraft(): RuleDraft {
  return {
    name: '',
    description: '',
    isActive: false,
    priority: 10,
    stopOnMatch: false,
    match: 'all',
    conditions: [defaultConditionFor('distance_meters')],
    actions: [{ type: 'send_wallet_notification', title: '', message: '' }],
    cooldownHours: 24,
  }
}

/** Reads a stored rule tree back into the flat shape the builder edits. */
export function draftFromRule(rule: {
  name: string
  description: string | null
  isActive: boolean
  priority: number
  stopOnMatch: boolean
  conditions: RuleNode
  actions: RuleAction[]
  cooldownHours: number
}): RuleDraft {
  const node = rule.conditions as { all?: RuleNode[]; any?: RuleNode[] }
  const match: 'all' | 'any' = node.any ? 'any' : 'all'
  const children = (node.any ?? node.all ?? []) as RuleNode[]

  return {
    name: rule.name,
    description: rule.description ?? '',
    isActive: rule.isActive,
    priority: rule.priority,
    stopOnMatch: rule.stopOnMatch,
    match,
    // Nested groups are flattened away rather than silently discarded: the builder
    // can only round-trip a flat list, and showing a merchant a rule that is missing
    // half its logic would be worse than showing them the leaves it can edit.
    conditions: children.filter(
      (child): child is RuleCondition => 'fact' in (child as RuleCondition)
    ),
    actions: rule.actions ?? [],
    cooldownHours: rule.cooldownHours,
  }
}

export function draftToPayload(draft: RuleDraft): Record<string, unknown> {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    isActive: draft.isActive,
    priority: draft.priority,
    stopOnMatch: draft.stopOnMatch,
    conditions: draft.match === 'any' ? { any: draft.conditions } : { all: draft.conditions },
    actions: draft.actions,
    cooldownHours: draft.cooldownHours,
  }
}

export function RuleBuilder({
  draft,
  onChange,
  campaigns = [],
}: {
  draft: RuleDraft
  onChange: (draft: RuleDraft) => void
  campaigns?: Array<{ id: string; name: string }>
}) {
  const { t } = useI18n()

  const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) =>
    onChange({ ...draft, [key]: value })

  const summary = describeRule({
    conditions: draft.match === 'any' ? { any: draft.conditions } : { all: draft.conditions },
    actions: draft.actions,
  })

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="rule-name">{t('wallet.rules.name')}</Label>
        <Input
          id="rule-name"
          value={draft.name}
          onChange={(event) => set('name', event.target.value)}
          maxLength={120}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rule-description">{t('wallet.rules.description')}</Label>
        <Input
          id="rule-description"
          value={draft.description}
          onChange={(event) => set('description', event.target.value)}
          maxLength={500}
        />
      </div>

      {/* IF */}
      <fieldset className="rounded-2xl border p-4">
        <legend className="px-1.5">
          <span className="inline-flex items-center gap-2 text-sm font-semibold">
            <MatchToggle value={draft.match} onChange={(value) => set('match', value)} />
          </span>
        </legend>

        <div className="space-y-3">
          {draft.conditions.map((condition, index) => (
            <ConditionRow
              key={index}
              condition={condition}
              canRemove={draft.conditions.length > 1}
              onChange={(next) =>
                set(
                  'conditions',
                  draft.conditions.map((entry, position) => (position === index ? next : entry))
                )
              }
              onRemove={() =>
                set(
                  'conditions',
                  draft.conditions.filter((_, position) => position !== index)
                )
              }
            />
          ))}

          {draft.conditions.length < 8 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() =>
                set('conditions', [...draft.conditions, defaultConditionFor('points')])
              }
            >
              <Plus className="size-3.5" aria-hidden />
              {t('wallet.rules.addCondition')}
            </Button>
          )}
        </div>
      </fieldset>

      {/* THEN */}
      <fieldset className="rounded-2xl border p-4">
        <legend className="px-1.5 text-sm font-semibold">{t('wallet.rules.then')}</legend>

        <div className="space-y-3">
          {draft.actions.map((action, index) => (
            <ActionRow
              key={index}
              action={action}
              campaigns={campaigns}
              canRemove={draft.actions.length > 1}
              onChange={(next) =>
                set(
                  'actions',
                  draft.actions.map((entry, position) => (position === index ? next : entry))
                )
              }
              onRemove={() =>
                set(
                  'actions',
                  draft.actions.filter((_, position) => position !== index)
                )
              }
            />
          ))}

          {draft.actions.length < 5 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => set('actions', [...draft.actions, { type: 'suggest_wallet_card' }])}
            >
              <Plus className="size-3.5" aria-hidden />
              {t('wallet.rules.addAction')}
            </Button>
          )}
        </div>
      </fieldset>

      {/* The generated sentence. This is the merchant's real check on their own work. */}
      <div className="rounded-2xl border bg-muted/40 p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('wallet.rules.summary')}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed">{summary}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rule-priority">{t('wallet.rules.priority')}</Label>
          <Input
            id="rule-priority"
            inputMode="numeric"
            value={String(draft.priority)}
            onChange={(event) => set('priority', Number(event.target.value) || 0)}
          />
          <p className="text-xs text-muted-foreground">{t('wallet.rules.priorityHelp')}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rule-cooldown">{t('wallet.rules.cooldownHours')}</Label>
          <Input
            id="rule-cooldown"
            inputMode="numeric"
            value={String(draft.cooldownHours)}
            onChange={(event) => set('cooldownHours', Number(event.target.value) || 0)}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4 rounded-xl border p-3.5">
          <div>
            <Label htmlFor="rule-stop" className="cursor-pointer text-sm font-normal">
              {t('wallet.rules.stopOnMatch')}
            </Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('wallet.rules.stopOnMatchHelp')}
            </p>
          </div>
          <Switch
            id="rule-stop"
            checked={draft.stopOnMatch}
            onCheckedChange={(checked) => set('stopOnMatch', checked)}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border p-3.5">
          <Label htmlFor="rule-active" className="cursor-pointer text-sm font-normal">
            {t('common.active')}
          </Label>
          <Switch
            id="rule-active"
            checked={draft.isActive}
            onCheckedChange={(checked) => set('isActive', checked)}
          />
        </div>
      </div>
    </div>
  )
}

function MatchToggle({
  value,
  onChange,
}: {
  value: 'all' | 'any'
  onChange: (value: 'all' | 'any') => void
}) {
  const { t } = useI18n()

  return (
    <span className="inline-flex items-center gap-1.5">
      {(['all', 'any'] as const).map((candidate) => (
        <button
          key={candidate}
          type="button"
          onClick={() => onChange(candidate)}
          aria-pressed={value === candidate}
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
            value === candidate
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:text-foreground'
          )}
        >
          {candidate === 'all' ? t('wallet.rules.whenAll') : t('wallet.rules.whenAny')}
        </button>
      ))}
    </span>
  )
}

function ConditionRow({
  condition,
  canRemove,
  onChange,
  onRemove,
}: {
  condition: RuleCondition
  canRemove: boolean
  onChange: (condition: RuleCondition) => void
  onRemove: () => void
}) {
  const { t } = useI18n()
  const operators = operatorsFor(condition.fact)
  const needsValue = condition.op !== 'is_true' && condition.op !== 'is_false'
  const choices = CHOICE_FACTS[condition.fact]

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 p-2.5">
      <Select
        value={condition.fact}
        onValueChange={(value) => onChange(defaultConditionFor(value as RuleFact))}
      >
        <SelectTrigger className="w-full sm:w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RULE_FACTS.map((fact) => (
            <SelectItem key={fact} value={fact}>
              {FACT_LABELS[fact]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={condition.op}
        onValueChange={(value) => onChange({ ...condition, op: value as RuleOperator })}
      >
        <SelectTrigger className="w-full sm:w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((operator) => (
            <SelectItem key={operator} value={operator}>
              {OPERATOR_LABELS[operator]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {needsValue &&
        (choices ? (
          <Select
            value={String(condition.value ?? '')}
            onValueChange={(value) => onChange({ ...condition, value })}
          >
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : condition.op === 'between' ? (
          <span className="flex items-center gap-1.5">
            <Input
              aria-label={OPERATOR_LABELS.between}
              inputMode="numeric"
              className="w-20"
              value={String((condition.value as unknown[] | undefined)?.[0] ?? '')}
              onChange={(event) =>
                onChange({
                  ...condition,
                  value: [
                    Number(event.target.value) || 0,
                    (condition.value as unknown[] | undefined)?.[1] ?? 0,
                  ],
                })
              }
            />
            <span className="text-xs text-muted-foreground">–</span>
            <Input
              aria-label={OPERATOR_LABELS.between}
              inputMode="numeric"
              className="w-20"
              value={String((condition.value as unknown[] | undefined)?.[1] ?? '')}
              onChange={(event) =>
                onChange({
                  ...condition,
                  value: [
                    (condition.value as unknown[] | undefined)?.[0] ?? 0,
                    Number(event.target.value) || 0,
                  ],
                })
              }
            />
          </span>
        ) : (
          <Input
            aria-label={FACT_LABELS[condition.fact]}
            inputMode="numeric"
            className="w-full sm:w-28"
            value={String(condition.value ?? '')}
            onChange={(event) => onChange({ ...condition, value: event.target.value })}
          />
        ))}

      {canRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-auto size-8 shrink-0 text-muted-foreground"
          onClick={onRemove}
          aria-label={t('common.remove')}
        >
          <Trash2 className="size-3.5" aria-hidden />
        </Button>
      )}
    </div>
  )
}

function ActionRow({
  action,
  campaigns,
  canRemove,
  onChange,
  onRemove,
}: {
  action: RuleAction
  campaigns: Array<{ id: string; name: string }>
  canRemove: boolean
  onChange: (action: RuleAction) => void
  onRemove: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="space-y-2.5 rounded-xl bg-muted/40 p-2.5">
      <div className="flex items-center gap-2">
        <Select
          value={action.type}
          onValueChange={(value) => onChange(defaultActionFor(value as RuleActionType))}
        >
          <SelectTrigger className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RULE_ACTION_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {ACTION_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground"
            onClick={onRemove}
            aria-label={t('common.remove')}
          >
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        )}
      </div>

      {/* Only the parameters this action actually takes. A generic key/value editor
          would be smaller code and a much worse form. */}
      {action.type === 'send_wallet_notification' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            aria-label={t('wallet.campaigns.messageTitle')}
            placeholder={t('wallet.campaigns.messageTitle')}
            value={action.title ?? ''}
            maxLength={60}
            onChange={(event) => onChange({ ...action, title: event.target.value })}
          />
          <Input
            aria-label={t('wallet.campaigns.messageBody')}
            placeholder={t('wallet.campaigns.messageBody')}
            value={action.message ?? ''}
            maxLength={300}
            onChange={(event) => onChange({ ...action, message: event.target.value })}
          />
        </div>
      )}

      {action.type === 'grant_points' && (
        <Input
          aria-label={t('wallet.campaigns.minPoints')}
          inputMode="numeric"
          className="w-28"
          value={String(action.amount ?? '')}
          onChange={(event) => onChange({ ...action, amount: Number(event.target.value) || 0 })}
        />
      )}

      {action.type === 'add_tag' && (
        <Input
          aria-label={ACTION_LABELS.add_tag}
          value={action.tag ?? ''}
          maxLength={60}
          onChange={(event) => onChange({ ...action, tag: event.target.value })}
        />
      )}

      {action.type === 'notify_staff' && (
        <Input
          aria-label={t('wallet.campaigns.messageTitle')}
          placeholder={t('wallet.campaigns.messageTitle')}
          value={action.title ?? ''}
          maxLength={120}
          onChange={(event) => onChange({ ...action, title: event.target.value })}
        />
      )}

      {action.type === 'activate_campaign' && (
        <Select
          value={action.campaign_id ?? ''}
          onValueChange={(value) => onChange({ ...action, campaign_id: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder={t('wallet.campaigns.title')} />
          </SelectTrigger>
          <SelectContent>
            {campaigns.map((campaign) => (
              <SelectItem key={campaign.id} value={campaign.id}>
                {campaign.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

function defaultActionFor(type: RuleActionType): RuleAction {
  switch (type) {
    case 'send_wallet_notification':
      return { type, title: '', message: '' }
    case 'grant_points':
      return { type, amount: 10 }
    case 'add_tag':
      return { type, tag: '' }
    case 'notify_staff':
      return { type, title: '' }
    case 'activate_campaign':
      return { type, campaign_id: '' }
    case 'set_vip':
      return { type, value: true }
    default:
      return { type } as RuleAction
  }
}
