import { z } from 'zod'

/**
 * Segment filter DSL.
 *
 * A saved segment stores this tree rather than a frozen customer list, so an
 * audience stays correct as people move in and out of it. The same definition
 * powers campaign targeting, automation eligibility and the customers table
 * filter bar — one language, three surfaces.
 *
 * Fields are an allow-list: a condition can only ever reference a column we
 * have explicitly approved, which is what makes compilation to SQL safe.
 */

export const SEGMENT_FIELDS = {
  // Identity
  email: { type: 'string', column: 'email', label: 'Email' },
  name: { type: 'string', column: 'name', label: 'Name' },
  phone: { type: 'string', column: 'phone', label: 'Phone' },
  locale: { type: 'string', column: 'locale', label: 'Language' },
  source: { type: 'enum', column: 'source', label: 'Signup source' },
  // Status
  is_vip: { type: 'boolean', column: 'is_vip', label: 'VIP' },
  status: { type: 'enum', column: 'status', label: 'Status' },
  // Dates
  created_at: { type: 'datetime', column: 'created_at', label: 'Joined' },
  last_visit: { type: 'datetime', column: 'last_visit', label: 'Last visit' },
  last_purchase_at: { type: 'datetime', column: 'last_purchase_at', label: 'Last purchase' },
  birthday: { type: 'date', column: 'birthday', label: 'Birthday' },
  anniversary: { type: 'date', column: 'anniversary', label: 'Anniversary' },
  // Behaviour
  visit_count: { type: 'number', column: 'visit_count', label: 'Visits' },
  lifetime_spend: { type: 'number', column: 'lifetime_spend', label: 'Total spend' },
  average_ticket: { type: 'number', column: 'average_ticket', label: 'Average ticket' },
  churn_risk: { type: 'number', column: 'churn_risk', label: 'Churn risk' },
  predicted_clv: { type: 'number', column: 'predicted_clv', label: 'Predicted value' },
  rfm_segment: { type: 'enum', column: 'rfm_segment', label: 'RFM segment' },
  // Consent
  consent_email: { type: 'boolean', column: 'consent_email', label: 'Email opt-in' },
  consent_sms: { type: 'boolean', column: 'consent_sms', label: 'SMS opt-in' },
  consent_whatsapp: { type: 'boolean', column: 'consent_whatsapp', label: 'WhatsApp opt-in' },
  consent_marketing: { type: 'boolean', column: 'consent_marketing', label: 'Marketing opt-in' },
  // Derived (resolved through a subquery rather than a plain column)
  balance: { type: 'derived', column: 'balance', label: 'Balance' },
  reward_available: { type: 'derived', column: 'reward_available', label: 'Reward ready' },
  tag: { type: 'derived', column: 'tag', label: 'Tag' },
  tier_level: { type: 'derived', column: 'tier_level', label: 'Tier level' },
} as const

export type SegmentField = keyof typeof SEGMENT_FIELDS

export const SEGMENT_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'not_contains',
  'starts_with',
  'in',
  'not_in',
  'is_true',
  'is_false',
  'is_set',
  'is_not_set',
  /** Datetime: within the last N days. */
  'within_days',
  /** Datetime: older than N days (or never). */
  'before_days',
  /** Date: month matches the current month. */
  'birthday_in_month',
  /** Date: month and day match today. */
  'birthday_today',
  /** Date: N days from today. */
  'birthday_in_days',
] as const

export type SegmentOperator = (typeof SEGMENT_OPERATORS)[number]

const conditionSchema = z.object({
  field: z.enum(Object.keys(SEGMENT_FIELDS) as [SegmentField, ...SegmentField[]]),
  operator: z.enum(SEGMENT_OPERATORS),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
})

export type SegmentCondition = z.infer<typeof conditionSchema>

export type SegmentDefinition = {
  match: 'all' | 'any'
  conditions: Array<SegmentCondition | SegmentDefinition>
}

/**
 * A nested group must declare its own `conditions`.
 *
 * Without this the union would fall through: an invalid condition (unknown
 * field or operator) would fail the condition branch, then parse as a *group*
 * with defaulted-empty conditions — silently turning "email = x" into "match
 * everybody". That is a targeting bug with real consequences, so the nested
 * form is strict and only the top level gets defaults.
 */
const groupSchema: z.ZodType<SegmentDefinition, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    match: z.enum(['all', 'any']).default('all'),
    conditions: z.array(z.union([conditionSchema, groupSchema])).max(50),
  })
)

/**
 * Recursive schema. Typed as `ZodType<Output, Def, Input>` with a separate
 * input type because `.default()` makes the parsed output required while the
 * incoming JSON may omit both fields.
 */
export const segmentDefinitionSchema: z.ZodType<SegmentDefinition, z.ZodTypeDef, unknown> =
  z.object({
    match: z.enum(['all', 'any']).default('all'),
    conditions: z.array(z.union([conditionSchema, groupSchema])).max(50).default([]),
  })

export function isGroup(node: SegmentCondition | SegmentDefinition): node is SegmentDefinition {
  return 'conditions' in node
}

export const EMPTY_SEGMENT: SegmentDefinition = { match: 'all', conditions: [] }

/** Human-readable summary shown on segment cards and campaign audience pickers. */
export function describeSegment(definition: SegmentDefinition): string {
  if (definition.conditions.length === 0) return 'All customers'
  const joiner = definition.match === 'all' ? ' and ' : ' or '
  return definition.conditions
    .map((node) => (isGroup(node) ? `(${describeSegment(node)})` : describeCondition(node)))
    .join(joiner)
}

function describeCondition(condition: SegmentCondition): string {
  const label = SEGMENT_FIELDS[condition.field].label
  const value = Array.isArray(condition.value) ? condition.value.join(', ') : condition.value

  switch (condition.operator) {
    case 'is_true':
      return `${label} is yes`
    case 'is_false':
      return `${label} is no`
    case 'is_set':
      return `${label} is set`
    case 'is_not_set':
      return `${label} is empty`
    case 'within_days':
      return `${label} in the last ${value} days`
    case 'before_days':
      return `${label} more than ${value} days ago`
    case 'birthday_in_month':
      return `${label} this month`
    case 'birthday_today':
      return `${label} today`
    case 'birthday_in_days':
      return `${label} in ${value} days`
    case 'in':
      return `${label} is one of ${value}`
    case 'not_in':
      return `${label} is none of ${value}`
    case 'contains':
      return `${label} contains "${value}"`
    case 'not_contains':
      return `${label} does not contain "${value}"`
    case 'starts_with':
      return `${label} starts with "${value}"`
    case 'gt':
      return `${label} > ${value}`
    case 'gte':
      return `${label} ≥ ${value}`
    case 'lt':
      return `${label} < ${value}`
    case 'lte':
      return `${label} ≤ ${value}`
    case 'neq':
      return `${label} is not ${value}`
    default:
      return `${label} is ${value}`
  }
}
