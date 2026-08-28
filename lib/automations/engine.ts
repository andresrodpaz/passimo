import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { enqueue } from '@/lib/jobs/queue'
import { dispatchMessage } from '@/lib/messaging/dispatch'
import { customerMatchesSegment, resolveSegmentDefinition } from '@/lib/segments/resolve'
import { createAdminGrantReward } from '@/lib/loyalty/grants'
import { notify } from '@/lib/notifications'
import { num } from '@/lib/domain/types'

/**
 * Automation engine.
 *
 * Automations are the product's compounding value: once a merchant switches on
 * "win back inactive customers", it earns them money every week with zero
 * effort, and switching platforms means losing it. The engine is a small,
 * explicit state machine — enrol, wait, re-check eligibility, act — rather than
 * a general workflow DSL, because merchants need to be able to predict it.
 */

export type AutomationTrigger =
  | 'customer_joined'
  | 'visit_recorded'
  | 'purchase_recorded'
  | 'reward_unlocked'
  | 'reward_redeemed'
  | 'birthday'
  | 'anniversary'
  | 'inactivity'
  | 'balance_expiring'
  | 'tier_upgraded'
  | 'referral_qualified'
  | 'nps_detractor'
  | 'nps_promoter'
  | 'membership_renewal'

export type AutomationAction =
  | { type: 'send_message'; channel?: string; template?: string; subject?: string; body?: string }
  | { type: 'grant_reward'; trigger?: string; reward_id?: string }
  | { type: 'grant_balance'; amount: number; program_id?: string; reason?: string }
  | { type: 'add_tag'; tag: string }
  | { type: 'set_vip'; value?: boolean }
  | { type: 'notify_staff'; title: string; body?: string }
  | { type: 'webhook'; event?: string }

type AutomationRow = {
  id: string
  business_id: string
  name: string
  trigger: string
  trigger_config: Record<string, unknown>
  delay_minutes: number
  segment_id: string | null
  conditions: Record<string, unknown>
  actions: AutomationAction[]
  cooldown_days: number
  respect_quiet_hours: boolean
}

/**
 * Enrols a customer into every active automation matching a trigger.
 * Cooldown de-duplication happens atomically in `passimo_enroll_automation`.
 */
export async function enrollCustomer(input: {
  businessId: string
  customerId: string
  trigger: AutomationTrigger
  eventId?: string | null
  /**
   * Facts the template needs that the customer record does not hold — which
   * plan is renewing, on what date, for how much. Captured at enrolment so the
   * delayed message states what was true when it was triggered, not what has
   * become true by the time it fires.
   */
  context?: Record<string, unknown>
}): Promise<{ enrolled: number }> {
  const admin = getDb()
  const { data: automations } = await admin
    .from('automations')
    .select('id, delay_minutes, segment_id')
    .eq('business_id', input.businessId)
    .eq('trigger', input.trigger)
    .eq('is_active', true)

  if (!automations?.length) return { enrolled: 0 }

  let enrolled = 0
  for (const automation of automations) {
    // Segment gate is checked at enrolment *and* again at run time, because a
    // customer can stop qualifying during the delay.
    if (automation.segment_id) {
      const definition = await resolveSegmentDefinition(
        input.businessId,
        automation.segment_id as string
      )
      const matches = await customerMatchesSegment(input.businessId, input.customerId, definition)
      if (!matches) continue
    }

    const scheduledFor = new Date(Date.now() + num(automation.delay_minutes) * 60_000)
    const { data: runId } = await admin.rpc('passimo_enroll_automation', {
      p_business_id: input.businessId,
      p_automation_id: automation.id,
      p_customer_id: input.customerId,
      p_scheduled_for: scheduledFor.toISOString(),
      p_event_id: input.eventId ?? null,
      p_context: input.context ?? {},
    })

    if (runId) {
      enrolled += 1
      await enqueue(
        'automation.run',
        { runId },
        {
          businessId: input.businessId,
          runAfter: scheduledFor,
          idempotencyKey: `automation-run:${runId}`,
        }
      )
    }
  }

  return { enrolled }
}

/** Executes one enrolled run. */
export async function runAutomation(runId: string): Promise<{ status: string; reason?: string }> {
  const admin = getDb()
  const { data: run } = await admin
    .from('automation_runs')
    .select('*, automations:automation_id (*)')
    .eq('id', runId)
    .maybeSingle()

  if (!run) return { status: 'missing' }
  if (run.status !== 'scheduled') return { status: run.status as string }

  const automation = run.automations as unknown as AutomationRow | null
  if (!automation) return { status: 'missing_automation' }

  await admin.from('automation_runs').update({ status: 'running' }).eq('id', runId)

  const skip = async (reason: string) => {
    await admin
      .from('automation_runs')
      .update({ status: 'skipped', skip_reason: reason, completed_at: new Date().toISOString() })
      .eq('id', runId)
    return { status: 'skipped', reason }
  }

  // Re-verify eligibility: the delay may have been hours or days.
  const { data: customer } = await admin
    .from('customers')
    .select('id, status, last_visit')
    .eq('id', run.customer_id as string)
    .maybeSingle()
  if (!customer || customer.status !== 'active') return skip('customer_inactive')

  if (automation.segment_id) {
    const definition = await resolveSegmentDefinition(
      automation.business_id,
      automation.segment_id
    )
    const stillMatches = await customerMatchesSegment(
      automation.business_id,
      run.customer_id as string,
      definition
    )
    if (!stillMatches) return skip('no_longer_in_segment')
  }

  // Inactivity automations must not fire at someone who just came back.
  if (automation.trigger === 'inactivity') {
    const days = num(automation.trigger_config?.days, 30)
    const lastVisit = customer.last_visit ? new Date(customer.last_visit as string) : null
    if (lastVisit && Date.now() - lastVisit.getTime() < days * 86_400_000) {
      return skip('customer_returned')
    }
  }

  const results: Array<Record<string, unknown>> = []
  for (const action of automation.actions ?? []) {
    try {
      results.push(
        await executeAction(
          automation,
          run.customer_id as string,
          runId,
          action,
          (run.context as Record<string, unknown>) ?? {}
        )
      )
    } catch (cause) {
      logger.error('automation.action_failed', { runId, action: action.type, cause })
      results.push({
        type: action.type,
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  await admin
    .from('automation_runs')
    .update({
      status: 'completed',
      actions_result: results,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId)

  await admin.rpc('passimo_increment_automation_completed', { p_automation_id: automation.id })

  return { status: 'completed' }
}

async function executeAction(
  automation: AutomationRow,
  customerId: string,
  runId: string,
  action: AutomationAction,
  context: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const admin = getDb()

  switch (action.type) {
    case 'send_message': {
      const outcome = await dispatchMessage({
        businessId: automation.business_id,
        customerId,
        channel: (action.channel as 'auto') ?? 'auto',
        templateKey: action.template ?? null,
        subject: action.subject ?? null,
        body: action.body ?? null,
        automationId: automation.id,
        automationRunId: runId,
        category: 'marketing',
        idempotencyKey: `automation:${runId}:message`,
        extraContext: context as Record<string, string | number>,
      })
      return { type: 'send_message', ok: outcome.sent, ...outcome }
    }

    case 'grant_reward': {
      const granted = await createAdminGrantReward({
        businessId: automation.business_id,
        customerId,
        autoGrantTrigger: action.trigger ?? null,
        rewardId: action.reward_id ?? null,
        source: `automation:${automation.name}`,
      })
      return { type: 'grant_reward', ok: Boolean(granted), reward: granted }
    }

    case 'grant_balance': {
      const { data: program } = await admin
        .from('loyalty_programs')
        .select('id')
        .eq('business_id', automation.business_id)
        .eq(action.program_id ? 'id' : 'is_default', action.program_id ?? true)
        .maybeSingle()
      if (!program) return { type: 'grant_balance', ok: false, error: 'no_program' }

      const { error } = await admin.rpc('passimo_credit_account', {
        p_business_id: automation.business_id,
        p_program_id: program.id,
        p_customer_id: customerId,
        p_amount: action.amount,
        p_entry_type: 'earn',
        p_reason: action.reason ?? automation.name,
        p_idempotency_key: `automation:${runId}:balance`,
      })
      return { type: 'grant_balance', ok: !error, amount: action.amount }
    }

    case 'add_tag': {
      const { data: tag } = await admin
        .from('tags')
        .upsert(
          { business_id: automation.business_id, name: action.tag },
          { onConflict: 'business_id,name' }
        )
        .select('id')
        .maybeSingle()
      if (!tag) return { type: 'add_tag', ok: false }
      await admin
        .from('customer_tags')
        .upsert(
          { customer_id: customerId, tag_id: tag.id, business_id: automation.business_id },
          { onConflict: 'customer_id,tag_id', ignoreDuplicates: true }
        )
      return { type: 'add_tag', ok: true, tag: action.tag }
    }

    case 'set_vip': {
      await admin
        .from('customers')
        .update({ is_vip: action.value ?? true })
        .eq('id', customerId)
        .eq('business_id', automation.business_id)
      return { type: 'set_vip', ok: true }
    }

    case 'notify_staff': {
      const recipients = await notify(automation.business_id, {
        type: 'automation',
        title: action.title,
        body: action.body ?? null,
        url: `/dashboard/customers/${customerId}`,
      })
      return { type: 'notify_staff', ok: true, recipients }
    }

    case 'webhook': {
      await enqueue(
        'webhook.deliver',
        {
          businessId: automation.business_id,
          event: action.event ?? 'automation.completed',
          data: { automation_id: automation.id, customer_id: customerId, run_id: runId },
        },
        { businessId: automation.business_id }
      )
      return { type: 'webhook', ok: true }
    }

    default:
      return { type: (action as { type: string }).type, ok: false, error: 'unknown_action' }
  }
}

/**
 * Time-based triggers have no originating event, so a nightly sweep finds the
 * customers who became eligible today (birthdays, anniversaries, inactivity,
 * expiring balances) and enrols them.
 */
export async function sweepTimeBasedAutomations(businessId?: string): Promise<{
  scanned: number
  enrolled: number
}> {
  const admin = getDb()
  const query = admin
    .from('automations')
    .select('id, business_id, trigger, trigger_config')
    .eq('is_active', true)
    .in('trigger', ['birthday', 'anniversary', 'inactivity', 'balance_expiring'])
  if (businessId) query.eq('business_id', businessId)

  const { data: automations } = await query
  let enrolled = 0
  let scanned = 0

  for (const automation of automations ?? []) {
    const customerIds = await findEligibleCustomers(
      automation.business_id as string,
      automation.trigger as string,
      (automation.trigger_config as Record<string, unknown>) ?? {}
    )
    scanned += customerIds.length

    for (const customerId of customerIds) {
      const result = await enrollCustomer({
        businessId: automation.business_id as string,
        customerId,
        trigger: automation.trigger as AutomationTrigger,
      })
      enrolled += result.enrolled
    }
  }

  return { scanned, enrolled }
}

async function findEligibleCustomers(
  businessId: string,
  trigger: string,
  config: Record<string, unknown>
): Promise<string[]> {
  const admin = getDb()

  if (trigger === 'birthday' || trigger === 'anniversary') {
    const daysBefore = num(config.days_before, 0)
    const target = new Date(Date.now() + daysBefore * 86_400_000)
    const { data } = await admin.rpc('passimo_customers_with_date_today', {
      p_business_id: businessId,
      p_column: trigger === 'birthday' ? 'birthday' : 'anniversary',
      p_month: target.getUTCMonth() + 1,
      p_day: target.getUTCDate(),
    })
    return (data ?? []).map((row: { id: string }) => row.id)
  }

  if (trigger === 'inactivity') {
    const days = num(config.days, 30)
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()
    const { data } = await admin
      .from('customers')
      .select('id')
      .eq('business_id', businessId)
      .eq('status', 'active')
      .lt('last_visit', cutoff)
      .limit(2000)
    return (data ?? []).map((row) => row.id as string)
  }

  if (trigger === 'balance_expiring') {
    const daysBefore = num(config.days_before, 14)
    const until = new Date(Date.now() + daysBefore * 86_400_000).toISOString()
    const { data } = await admin
      .from('loyalty_accounts')
      .select('customer_id')
      .eq('business_id', businessId)
      .gt('balance', 0)
      .not('next_expiry_at', 'is', null)
      .lte('next_expiry_at', until)
      .gte('next_expiry_at', new Date().toISOString())
      .limit(2000)
    return [...new Set((data ?? []).map((row) => row.customer_id as string))]
  }

  return []
}
