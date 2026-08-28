import 'server-only'
import { z } from 'zod'
import { generateStructured, generateText } from '@/lib/ai/client'
import { getDb } from '@/lib/db'
import { num } from '@/lib/domain/types'
import type { SegmentDefinition } from '@/lib/segments/definition'
import { SEGMENT_FIELDS, SEGMENT_OPERATORS } from '@/lib/segments/definition'

/**
 * Product-level AI capabilities.
 *
 * Each function assembles a compact, privacy-conscious business snapshot (never
 * raw customer PII beyond first names), asks for a structured result, and
 * returns something the UI can act on directly.
 */

const SYSTEM = `You are the growth strategist inside Passimo, a customer loyalty platform for local physical businesses (cafés, bakeries, barbers, salons, gyms, boutiques).

Your advice is read by a busy shop owner between customers. Therefore:
- Be concrete and quantified. "Send 120 lapsed customers a 2-for-1 on Tuesday" beats "consider re-engagement".
- Respect the constraint that every message costs money and goodwill. Never suggest blasting the whole list.
- Prefer actions the merchant can take today with the tools they already have.
- Never invent data. If the snapshot does not support a claim, do not make it.
- Write marketing copy that sounds like a local business owner, not a corporation. No emoji spam, no "Dear valued customer".
- Default to the language given in the locale field.`

// -----------------------------------------------------------------------------
// Business snapshot — the shared context every capability is grounded in
// -----------------------------------------------------------------------------

export type BusinessSnapshot = {
  name: string
  category: string | null
  city: string | null
  locale: string
  currency: string
  program: { type: string; unit: string; goal: number | null; reward: string | null } | null
  metrics: Record<string, number | string | null>
  segments: { name: string; count: number }[]
  topRewards: { name: string; redemptions: number }[]
  recentCampaigns: { name: string; type: string; sent: number; revenue: number }[]
}

export async function buildBusinessSnapshot(businessId: string): Promise<BusinessSnapshot> {
  const admin = getDb()
  const [business, program, overview, segments, campaigns] = await Promise.all([
    admin
      .from('businesses')
      .select('name, category, city, locale, currency')
      .eq('id', businessId)
      .maybeSingle(),
    admin
      .from('loyalty_programs')
      .select('type, unit_plural, goal_amount, reward_description')
      .eq('business_id', businessId)
      .eq('is_default', true)
      .maybeSingle(),
    admin.rpc('passimo_analytics_overview', { p_business_id: businessId, p_days: 30 }),
    admin
      .from('segments')
      .select('name, cached_count')
      .eq('business_id', businessId)
      .order('cached_count', { ascending: false, nullsFirst: false })
      .limit(10),
    admin
      .from('campaigns')
      .select('name, type, sent_count, attributed_revenue')
      .eq('business_id', businessId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const data = (overview.data ?? {}) as Record<string, Record<string, unknown>>

  return {
    name: (business.data?.name as string) ?? 'the business',
    category: (business.data?.category as string) ?? null,
    city: (business.data?.city as string) ?? null,
    locale: (business.data?.locale as string) ?? 'es',
    currency: (business.data?.currency as string) ?? 'EUR',
    program: program.data
      ? {
          type: program.data.type as string,
          unit: (program.data.unit_plural as string) ?? 'points',
          goal: num(program.data.goal_amount) || null,
          reward: (program.data.reward_description as string) ?? null,
        }
      : null,
    metrics: {
      total_customers: num(data.customers?.total),
      new_customers_30d: num(data.customers?.new),
      active_customers_30d: num(data.customers?.active),
      lapsed_customers: num(data.customers?.lapsed),
      repeat_rate_percent: num(data.customers?.repeat_rate),
      churn_rate_percent: num(data.customers?.churn_rate),
      revenue_30d: num(data.revenue?.period),
      revenue_previous_30d: num(data.revenue?.previous),
      average_ticket: num(data.revenue?.average_ticket),
      average_customer_value: num(data.revenue?.average_clv),
      visits_30d: num(data.engagement?.visits),
      redemptions_30d: num(data.engagement?.redemptions),
      nps: (data.nps?.score as number | null) ?? null,
    },
    segments: (segments.data ?? []).map((row) => ({
      name: row.name as string,
      count: num(row.cached_count),
    })),
    topRewards: ((data.top_rewards as unknown as { name: string; redemptions: number }[]) ?? []).map(
      (reward) => ({ name: reward.name, redemptions: num(reward.redemptions) })
    ),
    recentCampaigns: (campaigns.data ?? []).map((row) => ({
      name: row.name as string,
      type: (row.type as string) ?? 'manual',
      sent: num(row.sent_count),
      revenue: num(row.attributed_revenue),
    })),
  }
}

function snapshotPrompt(snapshot: BusinessSnapshot): string {
  return `BUSINESS SNAPSHOT
${JSON.stringify(snapshot, null, 2)}`
}

// -----------------------------------------------------------------------------
// 1. Campaign generation
// -----------------------------------------------------------------------------

export const generatedCampaignSchema = z.object({
  name: z.string(),
  goal: z.string(),
  channels: z.array(z.enum(['email', 'sms', 'whatsapp', 'push', 'wallet'])).min(1),
  audience_description: z.string(),
  suggested_segment_key: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  preheader: z.string().nullable().optional(),
  email_body: z.string().nullable().optional(),
  sms_body: z.string().nullable().optional(),
  whatsapp_body: z.string().nullable().optional(),
  push_title: z.string().nullable().optional(),
  push_body: z.string().nullable().optional(),
  offer: z.string().nullable().optional(),
  best_send_day: z.string().nullable().optional(),
  best_send_time: z.string().nullable().optional(),
  expected_impact: z.string(),
  reasoning: z.string(),
})

export type GeneratedCampaign = z.infer<typeof generatedCampaignSchema>

export async function generateCampaign(
  businessId: string,
  brief: string,
  snapshot?: BusinessSnapshot
): Promise<GeneratedCampaign> {
  const context = snapshot ?? (await buildBusinessSnapshot(businessId))
  return generateStructured<GeneratedCampaign>({
    system: SYSTEM,
    prompt: `${snapshotPrompt(context)}

The owner asked for: "${brief}"

Design one campaign. Write the actual copy they will send — not a description of it.
SMS must fit 160 characters. Push title must fit 40 characters.
Write in the locale "${context.locale}".`,
    schema: {
      type: 'object',
      required: ['name', 'goal', 'channels', 'audience_description', 'expected_impact', 'reasoning'],
      properties: {
        name: { type: 'string', description: 'Short internal name for the campaign' },
        goal: { type: 'string', description: 'One sentence: what business outcome this drives' },
        channels: {
          type: 'array',
          items: { type: 'string', enum: ['email', 'sms', 'whatsapp', 'push', 'wallet'] },
        },
        audience_description: { type: 'string' },
        suggested_segment_key: {
          type: ['string', 'null'],
          description: 'One of: all, active, at_risk, lost, new, vip, birthday_month, reward_ready, churn_risk, one_timers',
        },
        subject: { type: ['string', 'null'] },
        preheader: { type: ['string', 'null'] },
        email_body: { type: ['string', 'null'] },
        sms_body: { type: ['string', 'null'], maxLength: 160 },
        whatsapp_body: { type: ['string', 'null'] },
        push_title: { type: ['string', 'null'], maxLength: 40 },
        push_body: { type: ['string', 'null'] },
        offer: { type: ['string', 'null'] },
        best_send_day: { type: ['string', 'null'] },
        best_send_time: { type: ['string', 'null'] },
        expected_impact: { type: 'string' },
        reasoning: { type: 'string' },
      },
    },
    toolName: 'propose_campaign',
    toolDescription: 'Return a ready-to-send marketing campaign',
    validate: (value) => generatedCampaignSchema.parse(value),
  })
}

// -----------------------------------------------------------------------------
// 2. Business insights — the daily "what should I do today?" feed
// -----------------------------------------------------------------------------

export const insightSchema = z.object({
  kind: z.enum([
    'churn_risk',
    'campaign_suggestion',
    'reward_optimization',
    'anomaly',
    'segment_suggestion',
    'pricing',
    'summary',
    'review_theme',
  ]),
  title: z.string(),
  body: z.string(),
  severity: z.enum(['info', 'opportunity', 'warning', 'critical']),
  estimated_impact: z.number().nullable().optional(),
  confidence: z.number().min(0).max(1),
  action: z
    .object({
      type: z.enum(['create_campaign', 'adjust_rule', 'create_segment', 'contact_customers', 'none']),
      label: z.string(),
      payload: z.record(z.unknown()).optional(),
    })
    .nullable()
    .optional(),
})

export const insightsResponseSchema = z.object({ insights: z.array(insightSchema).max(6) })
export type GeneratedInsight = z.infer<typeof insightSchema>

export async function generateInsights(
  businessId: string,
  snapshot?: BusinessSnapshot
): Promise<GeneratedInsight[]> {
  const context = snapshot ?? (await buildBusinessSnapshot(businessId))
  const admin = getDb()
  const { data: anomalies } = await admin.rpc('passimo_detect_anomalies', {
    p_business_id: businessId,
  })

  const result = await generateStructured<z.infer<typeof insightsResponseSchema>>({
    system: SYSTEM,
    prompt: `${snapshotPrompt(context)}

STATISTICAL ANOMALIES (z-scores against a 60-day baseline)
${JSON.stringify(anomalies ?? {}, null, 2)}

Produce between 2 and 5 insights, ordered by how much money they are worth.
Every insight must reference a specific number from the snapshot.
Estimate impact in ${context.currency} where you reasonably can; use null when you cannot.
Write in the locale "${context.locale}".`,
    schema: {
      type: 'object',
      required: ['insights'],
      properties: {
        insights: {
          type: 'array',
          maxItems: 6,
          items: {
            type: 'object',
            required: ['kind', 'title', 'body', 'severity', 'confidence'],
            properties: {
              kind: {
                type: 'string',
                enum: [
                  'churn_risk',
                  'campaign_suggestion',
                  'reward_optimization',
                  'anomaly',
                  'segment_suggestion',
                  'pricing',
                  'summary',
                  'review_theme',
                ],
              },
              title: { type: 'string', maxLength: 90 },
              body: { type: 'string', maxLength: 600 },
              severity: { type: 'string', enum: ['info', 'opportunity', 'warning', 'critical'] },
              estimated_impact: { type: ['number', 'null'] },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              action: {
                type: ['object', 'null'],
                properties: {
                  type: {
                    type: 'string',
                    enum: [
                      'create_campaign',
                      'adjust_rule',
                      'create_segment',
                      'contact_customers',
                      'none',
                    ],
                  },
                  label: { type: 'string' },
                  payload: { type: 'object' },
                },
                required: ['type', 'label'],
              },
            },
          },
        },
      },
    },
    toolName: 'report_insights',
    toolDescription: 'Return prioritised, actionable business insights',
    validate: (value) => insightsResponseSchema.parse(value),
  })

  return result.insights
}

// -----------------------------------------------------------------------------
// 3. Natural-language segment builder
// -----------------------------------------------------------------------------

const segmentResponseSchema = z.object({
  name: z.string(),
  description: z.string(),
  definition: z.object({
    match: z.enum(['all', 'any']),
    conditions: z.array(
      z.object({
        field: z.string(),
        operator: z.string(),
        value: z.unknown().optional(),
      })
    ),
  }),
})

export async function generateSegment(
  request: string,
  locale = 'es'
): Promise<{ name: string; description: string; definition: SegmentDefinition }> {
  const result = await generateStructured<z.infer<typeof segmentResponseSchema>>({
    system: SYSTEM,
    fast: true,
    temperature: 0.1,
    prompt: `Translate this audience request into a segment definition.

REQUEST: "${request}"

AVAILABLE FIELDS
${Object.entries(SEGMENT_FIELDS)
  .map(([key, meta]) => `- ${key} (${meta.type}): ${meta.label}`)
  .join('\n')}

AVAILABLE OPERATORS
${SEGMENT_OPERATORS.join(', ')}

Rules:
- Use only the fields and operators listed above.
- "within_days" / "before_days" take a number of days as the value.
- "in" / "not_in" take an array of strings.
- Boolean checks use is_true / is_false with no value.
- Name the segment in the locale "${locale}".`,
    schema: {
      type: 'object',
      required: ['name', 'description', 'definition'],
      properties: {
        name: { type: 'string', maxLength: 60 },
        description: { type: 'string', maxLength: 200 },
        definition: {
          type: 'object',
          required: ['match', 'conditions'],
          properties: {
            match: { type: 'string', enum: ['all', 'any'] },
            conditions: {
              type: 'array',
              items: {
                type: 'object',
                required: ['field', 'operator'],
                properties: {
                  field: { type: 'string', enum: Object.keys(SEGMENT_FIELDS) },
                  operator: { type: 'string', enum: [...SEGMENT_OPERATORS] },
                  value: {},
                },
              },
            },
          },
        },
      },
    },
    toolName: 'build_segment',
    toolDescription: 'Convert a natural-language audience description into a segment definition',
    validate: (value) => segmentResponseSchema.parse(value),
  })

  return {
    name: result.name,
    description: result.description,
    definition: result.definition as SegmentDefinition,
  }
}

// -----------------------------------------------------------------------------
// 4. Reward / program optimisation
// -----------------------------------------------------------------------------

const optimizationSchema = z.object({
  verdict: z.enum(['too_easy', 'well_balanced', 'too_hard']),
  summary: z.string(),
  recommendations: z.array(
    z.object({
      change: z.string(),
      rationale: z.string(),
      expected_effect: z.string(),
      suggested_goal_amount: z.number().nullable().optional(),
      suggested_reward: z.string().nullable().optional(),
    })
  ),
})

export type ProgramOptimization = z.infer<typeof optimizationSchema>

export async function optimizeProgram(
  businessId: string,
  snapshot?: BusinessSnapshot
): Promise<ProgramOptimization> {
  const context = snapshot ?? (await buildBusinessSnapshot(businessId))
  const admin = getDb()

  // How far people actually get, and how many finish: the two numbers that
  // decide whether a loyalty goal is set correctly.
  const { data: distribution } = await admin
    .from('loyalty_accounts')
    .select('balance, lifetime_earned, rewards_earned')
    .eq('business_id', businessId)
    .limit(2000)

  const balances = (distribution ?? []).map((row) => num(row.balance))
  const completed = (distribution ?? []).filter((row) => num(row.rewards_earned) > 0).length

  return generateStructured<ProgramOptimization>({
    system: SYSTEM,
    prompt: `${snapshotPrompt(context)}

PROGRAM PERFORMANCE
- Accounts sampled: ${balances.length}
- Accounts that have completed at least one reward: ${completed} (${
      balances.length ? Math.round((completed / balances.length) * 100) : 0
    }%)
- Median current balance: ${median(balances)}
- Goal: ${context.program?.goal ?? 'not set'} ${context.program?.unit ?? ''}

Judge whether the goal is set correctly. A good loyalty goal is reachable in
3–6 visits for a regular customer; too high and people give up, too low and the
merchant gives away margin. Give 2–3 concrete changes.
Write in the locale "${context.locale}".`,
    schema: {
      type: 'object',
      required: ['verdict', 'summary', 'recommendations'],
      properties: {
        verdict: { type: 'string', enum: ['too_easy', 'well_balanced', 'too_hard'] },
        summary: { type: 'string' },
        recommendations: {
          type: 'array',
          maxItems: 4,
          items: {
            type: 'object',
            required: ['change', 'rationale', 'expected_effect'],
            properties: {
              change: { type: 'string' },
              rationale: { type: 'string' },
              expected_effect: { type: 'string' },
              suggested_goal_amount: { type: ['number', 'null'] },
              suggested_reward: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
    toolName: 'optimize_program',
    toolDescription: 'Assess and improve the loyalty program configuration',
    validate: (value) => optimizationSchema.parse(value),
  })
}

// -----------------------------------------------------------------------------
// 5. Customer summary — what staff should know before they say hello
// -----------------------------------------------------------------------------

export async function summarizeCustomer(
  businessId: string,
  customerId: string
): Promise<string> {
  const admin = getDb()
  const [customer, events, notes] = await Promise.all([
    admin
      .from('customers')
      .select(
        'first_name, name, created_at, last_visit, visit_count, lifetime_spend, average_ticket, rfm_segment, churn_risk, is_vip, birthday'
      )
      .eq('id', customerId)
      .eq('business_id', businessId)
      .maybeSingle(),
    admin
      .from('activity_events')
      .select('type, amount, occurred_at')
      .eq('customer_id', customerId)
      .order('occurred_at', { ascending: false })
      .limit(25),
    admin
      .from('customer_notes')
      .select('body, created_at')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  if (!customer.data) return ''

  return generateText({
    system: SYSTEM,
    fast: true,
    maxTokens: 350,
    temperature: 0.3,
    prompt: `Summarise this customer for a staff member in 2–3 short sentences.
Mention their pattern, their value, and one thing to do or say on the next visit.
Use only the first name. Do not restate raw numbers the staff can already see.

CUSTOMER
${JSON.stringify(customer.data, null, 2)}

RECENT ACTIVITY
${JSON.stringify(events.data ?? [], null, 2)}

STAFF NOTES
${JSON.stringify(notes.data ?? [], null, 2)}`,
  })
}

// -----------------------------------------------------------------------------
// 6. Review / survey theme extraction
// -----------------------------------------------------------------------------

const themesSchema = z.object({
  overall_sentiment: z.enum(['positive', 'neutral', 'negative']),
  themes: z.array(
    z.object({
      theme: z.string(),
      sentiment: z.enum(['positive', 'neutral', 'negative']),
      mentions: z.number(),
      example: z.string().nullable().optional(),
    })
  ),
  recommended_action: z.string(),
})

export async function analyzeFeedback(businessId: string) {
  const admin = getDb()
  const { data } = await admin
    .from('survey_responses')
    .select('score, scale_max, comment')
    .eq('business_id', businessId)
    .not('comment', 'is', null)
    .order('responded_at', { ascending: false })
    .limit(150)

  if (!data?.length) return null

  return generateStructured<z.infer<typeof themesSchema>>({
    system: SYSTEM,
    fast: true,
    temperature: 0.2,
    prompt: `Group these customer comments into themes.

${JSON.stringify(data, null, 2)}

Return at most 6 themes ordered by how often they appear. Quote one short real
example per theme. End with the single most valuable thing the owner should fix
or double down on.`,
    schema: {
      type: 'object',
      required: ['overall_sentiment', 'themes', 'recommended_action'],
      properties: {
        overall_sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
        themes: {
          type: 'array',
          maxItems: 6,
          items: {
            type: 'object',
            required: ['theme', 'sentiment', 'mentions'],
            properties: {
              theme: { type: 'string' },
              sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
              mentions: { type: 'number' },
              example: { type: ['string', 'null'] },
            },
          },
        },
        recommended_action: { type: 'string' },
      },
    },
    toolName: 'analyze_feedback',
    toolDescription: 'Extract themes and sentiment from customer feedback',
    validate: (value) => themesSchema.parse(value),
  })
}

// -----------------------------------------------------------------------------
// 7. Copy rewriting — the "make it shorter / warmer / in Spanish" control
// -----------------------------------------------------------------------------

export async function rewriteCopy(input: {
  text: string
  instruction: string
  channel: 'email' | 'sms' | 'whatsapp' | 'push'
  locale?: string
}): Promise<string> {
  const limits: Record<string, string> = {
    sms: 'Must fit in 160 characters.',
    push: 'Must fit in 120 characters.',
    whatsapp: 'Keep under 400 characters.',
    email: 'Keep under 150 words.',
  }
  return generateText({
    system: SYSTEM,
    fast: true,
    maxTokens: 600,
    prompt: `Rewrite this ${input.channel} message.

INSTRUCTION: ${input.instruction}
${limits[input.channel]}
Locale: ${input.locale ?? 'es'}
Return only the rewritten message, no preamble.

ORIGINAL:
${input.text}`,
  })
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}
