import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { ProgramType } from '@/lib/domain/types'

/**
 * The baseline earning rules a program of each type needs to work at all.
 *
 * This exists because a program's *type* and its *earning rules* were being set
 * in two different places that never spoke to each other, and the result was a
 * loyalty product that could not award loyalty.
 *
 * The path, exactly: `passimo_provision_business` creates every workspace with a
 * `stamps` program and one rule — `visit → fixed → 1`. Onboarding then asks the
 * merchant their trade, and `lib/onboarding/presets.ts` classifies gyms,
 * restaurants, retail and pharmacies as **points** programs with goals of 300 to
 * 500. The wizard PATCHes `/api/v1/programs` with the new type and goal, and that
 * handler wrote program columns only. The rule stayed `1 per visit`.
 *
 * So a gym owner finished onboarding with a card advertising "500 points for a
 * free personal training session" that awarded one point per visit. Five hundred
 * visits. Not slow — unreachable. The same for every trade the presets call
 * points, which is half of them, and it was invisible from the dashboard: the
 * program screen showed goal 500 and the rules screen showed a rule that awards
 * 1, and nothing on either screen relates those two numbers.
 *
 * `POST /api/v1/programs` was worse: it created a program with no rules at all.
 *
 * So the rules follow the type, in one function, called from both places.
 */

export type DefaultRule = {
  name: string
  trigger: 'visit' | 'purchase' | 'signup' | 'referral' | 'referred_signup'
  awardType: 'fixed' | 'per_currency' | 'per_item' | 'percent'
  awardAmount: number
  perAmount: number
  priority: number
}

/**
 * `per_currency` with `perAmount: 1` means "one point per unit of currency
 * spent", which is the convention every customer already understands from every
 * other loyalty card they hold. It is also the only accrual rate that makes a
 * goal expressed in points mean something: at 1 point per euro, a 500-point goal
 * is €500 of custom, which is a number a merchant can reason about.
 *
 * Both a `purchase` and a `visit` rule, because the two triggers are distinct and
 * the engine selects by trigger — so they cannot double-award. The `visit` rule
 * is the floor for a counter check-in where staff did not type an amount; without
 * it, scanning a customer on a points program credits nothing and the scan looks
 * broken.
 */
export function defaultRulesFor(
  type: ProgramType,
  options: { cashbackPercent?: number | null } = {}
): DefaultRule[] {
  const shared: DefaultRule[] = [
    { name: 'Welcome bonus', trigger: 'signup', awardType: 'fixed', awardAmount: 1, perAmount: 1, priority: 10 },
    { name: 'Referral bonus', trigger: 'referral', awardType: 'fixed', awardAmount: 2, perAmount: 1, priority: 20 },
    { name: 'Friend welcome bonus', trigger: 'referred_signup', awardType: 'fixed', awardAmount: 1, perAmount: 1, priority: 30 },
  ]

  switch (type) {
    case 'points':
      return [
        {
          name: 'Point per unit spent',
          trigger: 'purchase',
          awardType: 'per_currency',
          awardAmount: 1,
          perAmount: 1,
          priority: 100,
        },
        {
          name: 'Point per visit',
          trigger: 'visit',
          awardType: 'fixed',
          awardAmount: 1,
          perAmount: 1,
          priority: 110,
        },
        ...shared,
      ]

    case 'cashback':
      return [
        {
          name: 'Cashback on spend',
          trigger: 'purchase',
          awardType: 'percent',
          /*
           * Falls back to 5% rather than 0. A cashback program whose percentage
           * is null returns 0 from `baseAward`, which is the same silent nothing
           * this whole module exists to prevent.
           */
          awardAmount: options.cashbackPercent && options.cashbackPercent > 0 ? options.cashbackPercent : 5,
          perAmount: 1,
          priority: 100,
        },
        ...shared,
      ]

    case 'membership':
      /*
       * A membership's value is entitlement, not accrual — the multiplier and the
       * perks do the work. One visit rule so the visit is still recorded and the
       * member's history is not empty.
       */
      return [
        { name: 'Visit credit', trigger: 'visit', awardType: 'fixed', awardAmount: 1, perAmount: 1, priority: 100 },
        ...shared,
      ]

    case 'stamps':
    default:
      return [
        { name: 'Stamp per visit', trigger: 'visit', awardType: 'fixed', awardAmount: 1, perAmount: 1, priority: 100 },
        ...shared,
      ]
  }
}

/**
 * Brings a program's earning rules in line with its type.
 *
 * Deliberately conservative about what it overwrites:
 *
 *   - A trigger with **no** rule gets the default. That is the whole fix: a
 *     points program with no `purchase` rule earns nothing from spend.
 *   - A trigger whose only rule is still the *provisioned default* — same name,
 *     `fixed`, amount 1, untouched (`usage_count = 0`) — is rewritten to match
 *     the new type. Leaving it would keep the 1-per-visit rule that made the goal
 *     unreachable.
 *   - Anything a merchant has edited, or that has ever fired, is left alone. A
 *     type change must never silently rewrite a rule a business is running on,
 *     and `usage_count > 0` is the evidence that it is.
 *
 * Never throws. A program whose rules could not be adjusted is a program that
 * awards the wrong amount; a program that could not be *saved* is a merchant
 * staring at an error in onboarding. The first is recoverable from the Rules
 * screen, the second loses the signup.
 */
export async function syncDefaultEarningRules(
  businessId: string,
  programId: string,
  type: ProgramType,
  options: { cashbackPercent?: number | null } = {}
): Promise<void> {
  const admin = getDb()

  try {
    const { data: existing } = await admin
      .from('earning_rules')
      .select('id, name, trigger, award_type, award_amount, per_amount, usage_count, is_active')
      .eq('business_id', businessId)
      .eq('program_id', programId)

    const byTrigger = new Map<string, Array<Record<string, unknown>>>()
    for (const rule of existing ?? []) {
      const key = rule.trigger as string
      byTrigger.set(key, [...(byTrigger.get(key) ?? []), rule])
    }

    const wanted = defaultRulesFor(type, options)
    const toInsert: Array<Record<string, unknown>> = []

    for (const rule of wanted) {
      const present = byTrigger.get(rule.trigger) ?? []

      if (present.length === 0) {
        toInsert.push({
          business_id: businessId,
          program_id: programId,
          name: rule.name,
          trigger: rule.trigger,
          award_type: rule.awardType,
          award_amount: rule.awardAmount,
          per_amount: rule.perAmount,
          priority: rule.priority,
          is_active: true,
        })
        continue
      }

      const untouchedDefault = present.find(
        (candidate) =>
          Number(candidate.usage_count ?? 0) === 0 &&
          candidate.award_type === 'fixed' &&
          Number(candidate.award_amount) === 1 &&
          /* Only the names provisioning and this module generate. A merchant who
           * renamed a rule has taken ownership of it. */
          isGeneratedName(candidate.name as string)
      )

      /*
       * The name counts as a difference, not just the arithmetic. Provisioning
       * names the visit rule "Stamp per visit", and a points program keeps the
       * same `fixed 1` visit rule — so without this a gym's rules screen reads
       * "Stamp per visit" on a program that counts points, which is the sort of
       * leftover that makes a merchant distrust everything else on the page.
       */
      const differs =
        untouchedDefault !== undefined &&
        (untouchedDefault.award_type !== rule.awardType ||
          Number(untouchedDefault.award_amount) !== rule.awardAmount ||
          untouchedDefault.name !== rule.name)

      if (untouchedDefault && differs) {
        await admin
          .from('earning_rules')
          .update({
            name: rule.name,
            award_type: rule.awardType,
            award_amount: rule.awardAmount,
            per_amount: rule.perAmount,
            priority: rule.priority,
            is_active: true,
          })
          .eq('id', untouchedDefault.id as string)
          .eq('business_id', businessId)
      }
    }

    if (toInsert.length > 0) {
      await admin.from('earning_rules').insert(toInsert)
    }
  } catch (cause) {
    logger.warn('loyalty.default_rules_sync_failed', {
      business_id: businessId,
      program_id: programId,
      type,
      error: cause,
    })
  }
}

const GENERATED_NAMES = new Set([
  'Stamp per visit',
  'Point per visit',
  'Point per unit spent',
  'Visit credit',
  'Cashback on spend',
  'Welcome stamp',
  'Welcome bonus',
  'Referral bonus',
  'Friend welcome bonus',
])

function isGeneratedName(name: string | null): boolean {
  return name !== null && GENERATED_NAMES.has(name)
}
