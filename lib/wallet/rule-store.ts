import 'server-only'
import { getDb } from '@/lib/db'
import { notFound, unprocessable } from '@/lib/errors'
import { num } from '@/lib/domain/types'
import {
  validateActions,
  validateConditions,
  type ProximityRule,
  type RuleAction,
  type RuleNode,
} from '@/lib/wallet/rules'
import { findTemplate, resolveTemplateRule } from '@/lib/wallet/templates'
import { translatorForBusiness } from '@/lib/i18n/business'

/**
 * Storage for the no-code automation rules.
 *
 * Kept apart from `lib/wallet/rules.ts` on purpose: that file is the pure engine
 * and must stay importable by the client, so the visual builder can validate and
 * preview a rule with exactly the code that will run it. This file is the database
 * half.
 *
 * Rules are validated on write rather than on read. Storing a rule that can never
 * match is worse than refusing it, because the merchant believes it is live and
 * has no way to discover otherwise.
 */

const SELECT = '*'

type RuleRow = Record<string, unknown>

export function mapRule(row: RuleRow): ProximityRule {
  return {
    id: row.id as string,
    name: (row.name as string) ?? 'Rule',
    description: (row.description as string) ?? null,
    isActive: row.is_active === undefined ? true : Boolean(row.is_active),
    priority: num(row.priority),
    stopOnMatch: Boolean(row.stop_on_match),
    conditions: (row.conditions as RuleNode) ?? { all: [] },
    actions: Array.isArray(row.actions) ? (row.actions as RuleAction[]) : [],
    cooldownHours: num(row.cooldown_hours, 24),
    templateKey: (row.template_key as string) ?? null,
    matchCount: num(row.match_count),
    lastMatchedAt: (row.last_matched_at as string) ?? null,
  }
}

export async function listRules(
  businessId: string,
  options: { activeOnly?: boolean } = {}
): Promise<ProximityRule[]> {
  const admin = getDb()
  let query = admin
    .from('proximity_rules')
    .select(SELECT)
    .eq('business_id', businessId)
    .is('archived_at', null)
    .order('priority')
    .order('name')

  if (options.activeOnly) query = query.eq('is_active', true)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(mapRule)
}

export async function getRule(businessId: string, id: string): Promise<ProximityRule> {
  const admin = getDb()
  const { data } = await admin
    .from('proximity_rules')
    .select(SELECT)
    .eq('business_id', businessId)
    .eq('id', id)
    .maybeSingle()
  if (!data) throw notFound('Rule')
  return mapRule(data)
}

export type RuleInput = {
  name: string
  description?: string | null
  isActive?: boolean
  priority?: number
  stopOnMatch?: boolean
  conditions?: RuleNode
  actions?: RuleAction[]
  cooldownHours?: number
  templateKey?: string | null
}

function assertValid(input: Partial<RuleInput>): void {
  const errors: string[] = []
  if (input.conditions !== undefined) errors.push(...validateConditions(input.conditions))
  if (input.actions !== undefined) errors.push(...validateActions(input.actions))
  if (errors.length > 0) throw unprocessable(errors.join('. '))
}

function toRow(input: Partial<RuleInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  const set = (column: string, value: unknown) => {
    if (value !== undefined) row[column] = value
  }
  set('name', input.name)
  set('description', input.description)
  set('is_active', input.isActive)
  set('priority', input.priority)
  set('stop_on_match', input.stopOnMatch)
  set('conditions', input.conditions)
  set('actions', input.actions)
  set('cooldown_hours', input.cooldownHours)
  set('template_key', input.templateKey)
  return row
}

export async function createRule(
  businessId: string,
  input: RuleInput,
  actorId?: string | null
): Promise<ProximityRule> {
  assertValid(input)
  const admin = getDb()
  const { data, error } = await admin
    .from('proximity_rules')
    .insert({
      ...toRow(input),
      business_id: businessId,
      created_by: actorId ?? null,
      conditions: input.conditions ?? { all: [] },
      actions: input.actions ?? [],
    })
    .select('id')
    .single()

  if (error) throw unprocessable(error.message)
  return getRule(businessId, data.id as string)
}

export async function updateRule(
  businessId: string,
  id: string,
  input: Partial<RuleInput>
): Promise<ProximityRule> {
  assertValid(input)
  const patch = toRow(input)
  if (Object.keys(patch).length === 0) return getRule(businessId, id)

  const admin = getDb()
  const { error, count } = await admin
    .from('proximity_rules')
    .update(patch, { count: 'exact' })
    .eq('id', id)
    .eq('business_id', businessId)
  if (error) throw unprocessable(error.message)
  if (!count) throw notFound('Rule')
  return getRule(businessId, id)
}

export async function archiveRule(businessId: string, id: string): Promise<void> {
  const admin = getDb()
  const { error, count } = await admin
    .from('proximity_rules')
    .update({ archived_at: new Date().toISOString(), is_active: false }, { count: 'exact' })
    .eq('id', id)
    .eq('business_id', businessId)
  if (error) throw unprocessable(error.message)
  if (!count) throw notFound('Rule')
}

/**
 * Creates the rules from an industry template, skipping any already present.
 *
 * Matched on `template_key` rather than on name so a merchant who renamed
 * "Reward waiting nearby" to "Free coffee alert" does not get a duplicate the next
 * time they open the gallery.
 *
 * Resolved with the **business's** locale for the same reason template campaigns
 * are: a rule's actions carry notification copy, and that copy reaches customers
 * long after the request that seeded it.
 */
export async function applyTemplateRules(
  businessId: string,
  templateKey: string,
  actorId?: string | null
): Promise<{ created: number; skipped: number }> {
  const template = findTemplate(templateKey)
  if (!template) return { created: 0, skipped: 0 }

  const t = await translatorForBusiness(businessId)
  const rules = template.rules.map((rule) => resolveTemplateRule(rule, t))

  const admin = getDb()
  const { data: existing } = await admin
    .from('proximity_rules')
    .select('template_key')
    .eq('business_id', businessId)
    .not('template_key', 'is', null)

  const present = new Set((existing ?? []).map((row) => row.template_key as string))

  let created = 0
  let skipped = 0

  for (const rule of rules) {
    if (present.has(rule.templateKey)) {
      skipped += 1
      continue
    }
    await createRule(
      businessId,
      {
        name: rule.name,
        description: rule.description,
        // Same reasoning as template campaigns: a merchant reviews before their
        // customers receive anything.
        isActive: false,
        priority: rule.priority,
        stopOnMatch: rule.stopOnMatch ?? false,
        conditions: rule.conditions,
        actions: rule.actions,
        cooldownHours: rule.cooldownHours,
        templateKey: rule.templateKey,
      },
      actorId
    )
    present.add(rule.templateKey)
    created += 1
  }

  return { created, skipped }
}
