import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { programSchema, ruleSchema } from '@/lib/api/schemas'
import { getDb } from '@/lib/db'
import { unprocessable } from '@/lib/errors'
import { invalidateProgramConfig } from '@/lib/loyalty/engine'
import { syncDefaultEarningRules } from '@/lib/loyalty/default-rules'
import { recordAudit } from '@/lib/audit'
import { num } from '@/lib/domain/types'

export const runtime = 'nodejs'

const listQuery = z.object({ businessId: z.string().uuid() })

export const GET = defineRoute(
  {
    name: 'programs.list',
    auth: 'required',
    query: listQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['programs:read'],
    rateLimit: 'dashboard',
  },
  async ({ business }) => {
    const admin = getDb()
    const [programs, rules, tiers, stats] = await Promise.all([
      admin
        .from('loyalty_programs')
        .select('*')
        .eq('business_id', business.businessId)
        .order('is_default', { ascending: false }),
      admin
        .from('earning_rules')
        .select('*')
        .eq('business_id', business.businessId)
        .order('priority'),
      admin
        .from('program_tiers')
        .select('*')
        .eq('business_id', business.businessId)
        .order('level'),
      admin
        .from('loyalty_accounts')
        .select('program_id, balance')
        .eq('business_id', business.businessId)
        .limit(50000),
    ])

    // Outstanding balance is a real liability on the merchant's books; showing
    // it here is the difference between a toy and something a business trusts.
    const liability = new Map<string, { members: number; outstanding: number }>()
    for (const account of stats.data ?? []) {
      const key = account.program_id as string
      const current = liability.get(key) ?? { members: 0, outstanding: 0 }
      current.members += 1
      current.outstanding += num(account.balance)
      liability.set(key, current)
    }

    return {
      programs: (programs.data ?? []).map((program) => ({
        ...program,
        goal_amount: program.goal_amount === null ? null : num(program.goal_amount),
        cashback_percent: program.cashback_percent === null ? null : num(program.cashback_percent),
        point_value: program.point_value === null ? null : num(program.point_value),
        members: liability.get(program.id as string)?.members ?? 0,
        outstanding_balance: liability.get(program.id as string)?.outstanding ?? 0,
        estimated_liability:
          (liability.get(program.id as string)?.outstanding ?? 0) *
          num(program.point_value, program.type === 'stamps' ? 0 : 0.01),
      })),
      rules: (rules.data ?? []).map((rule) => ({
        ...rule,
        award_amount: num(rule.award_amount),
        per_amount: num(rule.per_amount, 1),
      })),
      tiers: (tiers.data ?? []).map((tier) => ({
        ...tier,
        threshold: num(tier.threshold),
        earn_multiplier: num(tier.earn_multiplier, 1),
      })),
    }
  }
)

export const POST = defineRoute(
  {
    name: 'programs.create',
    auth: 'required',
    body: programSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['programs:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, actor, business, request }) => {
    const admin = getDb()

    // Only one program can be the default; flip the previous one first.
    if (body.isDefault) {
      await admin
        .from('loyalty_programs')
        .update({ is_default: false })
        .eq('business_id', business.businessId)
    }

    const { data, error } = await admin
      .from('loyalty_programs')
      .insert({
        business_id: business.businessId,
        name: body.name,
        type: body.type,
        unit_singular: body.unitSingular ?? defaultUnit(body.type).singular,
        unit_plural: body.unitPlural ?? defaultUnit(body.type).plural,
        description: body.description ?? null,
        goal_amount: body.goalAmount ?? null,
        reward_description: body.rewardDescription ?? null,
        cashback_percent: body.cashbackPercent ?? null,
        point_value: body.pointValue ?? null,
        expiry_months: body.expiryMonths ?? null,
        earn_cooldown_minutes: body.earnCooldownMinutes ?? 0,
        max_earn_per_day: body.maxEarnPerDay ?? null,
        tier_enabled: body.tierEnabled ?? false,
        tier_metric: body.tierMetric ?? 'lifetime_earned',
        is_active: body.isActive ?? true,
        is_default: body.isDefault ?? false,
      })
      .select('id')
      .single()

    if (error) throw unprocessable(error.message)

    /*
     * A program with no earning rules awards nothing. This route used to create
     * exactly that — the merchant got a program, a goal and a reward, and every
     * scan credited zero. The rules follow the type; see
     * `lib/loyalty/default-rules.ts` for why they have to be derived rather than
     * assumed.
     */
    await syncDefaultEarningRules(business.businessId, data.id as string, body.type, {
      cashbackPercent: body.cashbackPercent ?? null,
    })

    invalidateProgramConfig(business.businessId)

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'program.created',
      resourceType: 'program',
      resourceId: data.id,
      summary: `Created ${body.type} program "${body.name}"`,
      request,
    })

    return { program_id: data.id }
  }
)

const updateSchema = programSchema.partial().extend({
  businessId: z.string().uuid(),
  id: z.string().uuid(),
})

export const PATCH = defineRoute(
  {
    name: 'programs.update',
    auth: 'required',
    body: updateSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['programs:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, actor, business, request }) => {
    const admin = getDb()
    if (body.isDefault) {
      await admin
        .from('loyalty_programs')
        .update({ is_default: false })
        .eq('business_id', business.businessId)
        .neq('id', body.id)
    }

    const map: Record<string, string> = {
      name: 'name',
      unitSingular: 'unit_singular',
      unitPlural: 'unit_plural',
      description: 'description',
      goalAmount: 'goal_amount',
      rewardDescription: 'reward_description',
      cashbackPercent: 'cashback_percent',
      pointValue: 'point_value',
      expiryMonths: 'expiry_months',
      earnCooldownMinutes: 'earn_cooldown_minutes',
      maxEarnPerDay: 'max_earn_per_day',
      tierEnabled: 'tier_enabled',
      tierMetric: 'tier_metric',
      isActive: 'is_active',
      isDefault: 'is_default',
    }
    const patch: Record<string, unknown> = {}
    for (const [key, column] of Object.entries(map)) {
      const value = (body as Record<string, unknown>)[key]
      if (value !== undefined) patch[column] = value
    }
    if (Object.keys(patch).length === 0) throw unprocessable('Nothing to update')

    const { error } = await admin
      .from('loyalty_programs')
      .update(patch)
      .eq('id', body.id)
      .eq('business_id', business.businessId)
    if (error) throw unprocessable(error.message)

    /*
     * Changing the type has to change how earning works, or it changes nothing
     * that matters.
     *
     * This is the call onboarding makes: it PATCHes `type: 'points'` and
     * `goalAmount: 500` onto the stamps program that provisioning created, and
     * before this line the provisioned `visit → fixed → 1` rule survived — so the
     * gym owner's 500-point card earned one point a visit. `syncDefaultEarningRules`
     * rewrites only the untouched provisioned rule and never a rule the merchant
     * has edited or that has already fired.
     */
    if (body.type !== undefined) {
      await syncDefaultEarningRules(business.businessId, body.id, body.type, {
        cashbackPercent: body.cashbackPercent ?? null,
      })
    }

    invalidateProgramConfig(business.businessId)
    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'program.updated',
      resourceType: 'program',
      resourceId: body.id,
      summary: `Updated ${Object.keys(patch).join(', ')}`,
      request,
    })

    return { ok: true }
  }
)

/** Create or replace an earning rule. */
export const PUT = defineRoute(
  {
    name: 'programs.upsert_rule',
    auth: 'required',
    body: ruleSchema.extend({ id: z.string().uuid().optional() }),
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['programs:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, business }) => {
    const admin = getDb()
    const row = {
      business_id: business.businessId,
      program_id: body.programId,
      name: body.name,
      trigger: body.trigger,
      award_type: body.awardType,
      award_amount: body.awardAmount,
      per_amount: body.perAmount,
      max_award: body.maxAward ?? null,
      min_purchase: body.minPurchase ?? null,
      milestone_threshold: body.milestoneThreshold ?? null,
      days_of_week: body.daysOfWeek ?? null,
      time_from: body.timeFrom ?? null,
      time_to: body.timeTo ?? null,
      starts_at: body.startsAt ?? null,
      ends_at: body.endsAt ?? null,
      location_ids: body.locationIds ?? null,
      segment_id: body.segmentId ?? null,
      cooldown_minutes: body.cooldownMinutes,
      usage_limit_per_customer: body.usageLimitPerCustomer ?? null,
      total_usage_limit: body.totalUsageLimit ?? null,
      priority: body.priority,
      stackable: body.stackable,
      is_active: body.isActive,
    }

    const { data, error } = body.id
      ? await admin
          .from('earning_rules')
          .update(row)
          .eq('id', body.id)
          .eq('business_id', business.businessId)
          .select('id')
          .maybeSingle()
      : await admin.from('earning_rules').insert(row).select('id').single()

    if (error) throw unprocessable(error.message)
    invalidateProgramConfig(business.businessId)
    return { rule_id: data?.id }
  }
)

function defaultUnit(type: string): { singular: string; plural: string } {
  switch (type) {
    case 'stamps':
      return { singular: 'stamp', plural: 'stamps' }
    case 'cashback':
      return { singular: 'credit', plural: 'credits' }
    case 'membership':
      return { singular: 'benefit', plural: 'benefits' }
    default:
      return { singular: 'point', plural: 'points' }
  }
}
