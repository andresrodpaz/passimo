import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { AppError } from '@/lib/errors'
import {
  DEFAULT_TRIAL_DAYS,
  ENTRY_PLAN,
  PLANS,
  TRIAL_EXPIRED_PLAN,
  TRIAL_PLAN,
  USAGE_METRICS,
  lowestPlanWith,
  lowestPlanWithLimit,
  normalizePlanId,
  type Feature,
  type LimitKey,
  type Limits,
  type Plan,
  type PlanId,
  type UsageMetric,
} from '@/lib/billing/plans'

/**
 * Entitlement resolution and enforcement.
 *
 * One gate, like `dispatchMessage` is for sending and `requireBusinessAccess`
 * is for authorisation: every "may this business do this?" question is answered
 * here. A new paid feature is a `requireFeature` call, not a scattering of
 * `plan === 'pro'` comparisons that drift the moment pricing changes.
 *
 * Three rules the implementation encodes:
 *
 *  1. **Billing never breaks the product.** If Stripe is not configured, or the
 *     usage table is unreachable, the merchant keeps working. A failed limit
 *     lookup logs and allows — losing a sale to our own outage is worse than
 *     letting someone exceed a quota by a few hundred rows.
 *
 *  2. **Reads are never gated.** A downgrade must never hide data a merchant
 *     already has. Exceeding the customer limit stops *adding* customers; it
 *     does not hide the ones already there, and it never stops a POS scan —
 *     an existing customer standing at the counter always gets their stamp.
 *
 *  3. **Every refusal names its remedy.** A blocked call returns the cheapest
 *     plan that would have allowed it, so the UI can render one button.
 */

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

export type UpgradeDetails = {
  reason: 'feature' | 'limit'
  feature?: Feature
  limit?: LimitKey
  used?: number
  allowed?: number
  current_plan: PlanId
  /** The cheapest plan that would allow the blocked action. */
  suggested_plan: PlanId | null
}

/**
 * 402. Distinct from `forbidden` on purpose: 403 means "your role cannot do
 * this", 402 means "your plan cannot do this". The UI shows a paywall for one
 * and an access error for the other, and conflating them is how merchants end
 * up emailing support instead of upgrading.
 */
export class UpgradeRequiredError extends AppError {
  readonly upgrade: UpgradeDetails

  constructor(message: string, upgrade: UpgradeDetails) {
    super('payment_required', message, { details: upgrade })
    this.name = 'UpgradeRequiredError'
    this.upgrade = upgrade
  }
}

// -----------------------------------------------------------------------------
// Resolution
// -----------------------------------------------------------------------------

export type Entitlements = {
  businessId: string
  /**
   * The tier this workspace falls back to — **not** the raw column value.
   *
   * The docstring used to say "straight from the `businesses` row", and it was
   * wrong in the one case that matters: a trialling workspace stores `trial`,
   * which is a lifecycle state rather than a tier, so `normalizePlanId` returns
   * null and this becomes `lapsed`. Read on its own it says a live trial has no
   * subscription, which is how the admin console came to label every trial
   * "Inactive". `effectivePlan` is what gates and what every screen should show;
   * `storedPlan` below is the column, unmodified, for anything that needs to tell
   * "trialling" from "trial ended".
   */
  plan: PlanId
  /** The raw `businesses.plan` value, including `trial`. */
  storedPlan: string | null
  /** The tier whose features actually apply right now (a live trial gets more). */
  effectivePlan: PlanId
  planDefinition: Plan
  limits: Limits
  features: ReadonlySet<Feature>
  trial: {
    active: boolean
    endsAt: string | null
    daysRemaining: number
  }
  /**
   * True when the workspace has no live entitlement at all: the trial ended
   * without a card, or the subscription was cancelled. Reads still work; every
   * write is refused with one remedy. The UI renders a reactivation wall from
   * this single flag rather than inferring it from four billing fields.
   */
  lapsed: boolean
  subscription: {
    status: string | null
    interval: 'month' | 'year'
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    /** True when Stripe says we are not being paid: past_due, unpaid, incomplete. */
    delinquent: boolean
  }
  referralCredit: number
}

type BusinessBillingRow = {
  id: string
  plan: string | null
  plan_interval: string | null
  trial_ends_at: string | null
  subscription_status: string | null
  subscription_current_period_end: string | null
  cancel_at_period_end: boolean | null
  stripe_subscription_id: string | null
  referral_credit: number | string | null
}

const CACHE_TTL_MS = 15_000
const cache = new Map<string, { value: Entitlements; expiresAt: number }>()

/** Drop the memo after any billing change so the merchant sees it immediately. */
export function invalidateEntitlements(businessId?: string): void {
  if (businessId) cache.delete(businessId)
  else cache.clear()
}

const DELINQUENT_STATUSES = new Set(['past_due', 'unpaid', 'incomplete_expired'])

export async function getEntitlements(businessId: string): Promise<Entitlements> {
  const cached = cache.get(businessId)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const admin = getDb()
  const { data } = await admin
    .from('businesses')
    .select(
      'id, plan, plan_interval, trial_ends_at, subscription_status, subscription_current_period_end, cancel_at_period_end, stripe_subscription_id, referral_credit'
    )
    .eq('id', businessId)
    .maybeSingle()

  const value = resolveEntitlements(businessId, (data ?? null) as BusinessBillingRow | null)
  cache.set(businessId, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  return value
}

/**
 * Pure resolution, exported so the rules are unit-testable without a database.
 */
export function resolveEntitlements(
  businessId: string,
  row: BusinessBillingRow | null,
  now: Date = new Date()
): Entitlements {
  const storedPlan = row?.plan
  /*
   * `normalizePlanId` also maps the pre-paid-only identifiers (`free`,
   * `enterprise`) so a deploy cannot gate a paying customer in the window
   * before migration 15 rewrites their row.
   */
  const plan: PlanId = normalizePlanId(storedPlan) ?? TRIAL_EXPIRED_PLAN

  const trialEndsAt = row?.trial_ends_at ? new Date(row.trial_ends_at) : null
  const onTrial = storedPlan === 'trial' || plan === TRIAL_EXPIRED_PLAN
  const trialActive = Boolean(
    onTrial && trialEndsAt && trialEndsAt.getTime() > now.getTime()
  )
  const daysRemaining = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86_400_000))
    : 0

  const status = row?.subscription_status ?? null
  const delinquent = Boolean(status && DELINQUENT_STATUSES.has(status))

  // A paying-but-delinquent account keeps its plan for the grace period Stripe
  // manages; dropping them to Free the hour a card expires is how you lose a
  // customer over a bank's fraud check.
  const effectivePlan: PlanId = trialActive ? TRIAL_PLAN : plan

  const definition = PLANS[effectivePlan]

  return {
    businessId,
    plan,
    storedPlan: storedPlan ?? null,
    effectivePlan,
    planDefinition: definition,
    limits: definition.limits,
    features: new Set(definition.features),
    trial: {
      active: trialActive,
      endsAt: row?.trial_ends_at ?? null,
      daysRemaining: trialActive ? daysRemaining : 0,
    },
    lapsed: effectivePlan === TRIAL_EXPIRED_PLAN,
    subscription: {
      status,
      interval: row?.plan_interval === 'year' ? 'year' : 'month',
      currentPeriodEnd: row?.subscription_current_period_end ?? null,
      cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end),
      delinquent,
    },
    referralCredit: Number(row?.referral_credit ?? 0) || 0,
  }
}

/**
 * What tier a stored `businesses.plan` value actually means.
 *
 * Exists because `normalizePlanId` deliberately does not know about `'trial'`.
 * `'trial'` is a *lifecycle state* the column is allowed to hold, not a tier in
 * the catalogue — there is nothing to charge for it and nothing to gate on it —
 * so `normalizePlanId('trial')` returns null, and every caller that wrote
 * `normalizePlanId(row.plan) ?? 'lapsed'` therefore labelled every trialling
 * workspace **Inactive**. In the admin console that meant the plan breakdown
 * counted live trials as churn, the workspace list showed "Inactive" in the same
 * row as a future `trial_ends_at`, and the business drawer overwrote the stored
 * `plan` with `lapsed` on the way out.
 *
 * The fix is not to teach `normalizePlanId` a fifth tier; it is to make the one
 * place that already resolves this correctly — `resolveEntitlements` — reachable
 * from a plain row. Reads that need a label call this; reads that need gates
 * still call `getEntitlements`.
 */
export type StoredPlanDescription = {
  /** The tier being billed. `lapsed` while a trial is running or has ended. */
  plan: PlanId
  /** The tier whose features apply right now. A live trial resolves to Pro. */
  effectivePlan: PlanId
  /** True while the trial window is open. */
  onTrial: boolean
  /** True when there is no live entitlement at all: no trial, no subscription. */
  lapsed: boolean
  /** The tier name to show in a table cell. */
  label: string
}

export function describeStoredPlan(
  row: {
    plan?: string | null
    plan_interval?: string | null
    trial_ends_at?: string | null
    subscription_status?: string | null
  } | null,
  now: Date = new Date()
): StoredPlanDescription {
  const resolved = resolveEntitlements(
    '',
    {
      id: '',
      plan: row?.plan ?? null,
      plan_interval: row?.plan_interval ?? null,
      trial_ends_at: row?.trial_ends_at ?? null,
      subscription_status: row?.subscription_status ?? null,
      subscription_current_period_end: null,
      cancel_at_period_end: null,
      stripe_subscription_id: null,
      referral_credit: null,
    },
    now
  )

  return {
    plan: resolved.plan,
    effectivePlan: resolved.effectivePlan,
    onTrial: resolved.trial.active,
    lapsed: resolved.lapsed,
    label: PLANS[resolved.effectivePlan].name,
  }
}

// -----------------------------------------------------------------------------
// Feature gates
// -----------------------------------------------------------------------------

export async function hasFeature(businessId: string, feature: Feature): Promise<boolean> {
  const entitlements = await getEntitlements(businessId)
  return entitlements.features.has(feature)
}

/** Throws `UpgradeRequiredError` when the plan does not include the feature. */
export async function requireFeature(businessId: string, feature: Feature): Promise<void> {
  const entitlements = await getEntitlements(businessId)
  if (entitlements.features.has(feature)) return

  const suggested = lowestPlanWith(feature) ?? (entitlements.lapsed ? ENTRY_PLAN : null)
  throw new UpgradeRequiredError(
    entitlements.lapsed
      ? `Your subscription is inactive. Reactivate from ${suggested?.name ?? ENTRY_PLAN.name} to use this again — nothing has been deleted.`
      : `${PLANS[entitlements.effectivePlan].name} does not include this. ${
          suggested ? `Available from ${suggested.name}.` : 'Contact us to enable it.'
        }`,
    {
      reason: 'feature',
      feature,
      current_plan: entitlements.effectivePlan,
      suggested_plan: suggested?.id ?? null,
    }
  )
}

// -----------------------------------------------------------------------------
// Limits
// -----------------------------------------------------------------------------

export type LimitStatus = {
  key: LimitKey
  used: number
  allowed: number | null
  /** 0–1, or 0 when the limit is unlimited. */
  ratio: number
  exceeded: boolean
  /** True from 80% — the point at which we should be prompting, not blocking. */
  approaching: boolean
}

/** Current calendar month, matching `passimo_track_usage`'s default period. */
export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Counts a resource against its cap.
 *
 * Countable limits are measured with a `head: true` count so no rows cross the
 * wire; metered ones read the pre-aggregated counter.
 */
export async function measureLimit(
  businessId: string,
  key: LimitKey,
  entitlements?: Entitlements
): Promise<LimitStatus> {
  const resolved = entitlements ?? (await getEntitlements(businessId))
  const allowed = resolved.limits[key]
  const used = await currentUsage(businessId, key)

  const ratio = allowed === null || allowed === 0 ? 0 : Math.min(2, used / allowed)
  return {
    key,
    used,
    allowed,
    ratio,
    exceeded: allowed !== null && used >= allowed,
    approaching: allowed !== null && allowed > 0 && used / allowed >= 0.8,
  }
}

async function currentUsage(businessId: string, key: LimitKey): Promise<number> {
  const admin = getDb()

  try {
    switch (key) {
      case 'customers': {
        const { count } = await admin
          .from('customers')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .neq('status', 'anonymized')
        return count ?? 0
      }
      case 'locations': {
        const { count } = await admin
          .from('locations')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .is('archived_at', null)
        return count ?? 0
      }
      case 'team_members': {
        const { count } = await admin
          .from('team_members')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('status', 'active')
        return count ?? 0
      }
      /*
       * Proximity campaigns and rules are capped by how many are *switched on*,
       * not how many were ever drafted. A merchant experimenting with twenty
       * ideas and running two is inside a two-campaign plan; charging for drafts
       * would teach them to delete their own work.
       */
      case 'proximity_campaigns': {
        const { count } = await admin
          .from('proximity_campaigns')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('status', 'active')
          .is('archived_at', null)
        return count ?? 0
      }
      case 'automation_rules': {
        const { count } = await admin
          .from('proximity_rules')
          .select('id', { count: 'exact', head: true })
          .eq('business_id', businessId)
          .eq('is_active', true)
          .is('archived_at', null)
        return count ?? 0
      }
      default: {
        const { data } = await admin
          .from('usage_counters')
          .select('used')
          .eq('business_id', businessId)
          .eq('period', currentPeriod())
          .eq('metric', key)
          .maybeSingle()
        return Number(data?.used ?? 0) || 0
      }
    }
  } catch (error) {
    // Rule 1: a metering failure must never block the merchant.
    logger.warn('entitlements.usage_read_failed', { business_id: businessId, key, error })
    return 0
  }
}

/**
 * Throws when adding `amount` more of a resource would cross the plan's cap.
 *
 * Checked *before* the write, so the caller never has to roll back.
 */
export async function requireWithinLimit(
  businessId: string,
  key: LimitKey,
  amount = 1
): Promise<LimitStatus> {
  const entitlements = await getEntitlements(businessId)
  const status = await measureLimit(businessId, key, entitlements)
  if (status.allowed === null) return status
  if (status.used + amount <= status.allowed) return status

  const suggested = lowestPlanWithLimit(key, status.used + amount)
  throw new UpgradeRequiredError(
    entitlements.lapsed
      ? `Your subscription is inactive, so nothing new can be added. Reactivate from ${ENTRY_PLAN.name} — your ${LIMIT_NOUNS[key]} are all still here.`
      : `Your ${PLANS[entitlements.effectivePlan].name} plan includes ${status.allowed.toLocaleString()} ${
          LIMIT_NOUNS[key]
        }. You have ${status.used.toLocaleString()}.`,
    {
      reason: 'limit',
      limit: key,
      used: status.used,
      allowed: status.allowed,
      current_plan: entitlements.effectivePlan,
      suggested_plan: suggested?.id ?? null,
    }
  )
}

const LIMIT_NOUNS: Record<LimitKey, string> = {
  customers: 'customers',
  locations: 'locations',
  team_members: 'team members',
  messages_per_month: 'messages a month',
  ai_actions_per_month: 'AI actions a month',
  campaigns_per_month: 'campaigns a month',
  proximity_campaigns: 'proximity campaigns',
  automation_rules: 'automation rules',
}

// -----------------------------------------------------------------------------
// Metering
// -----------------------------------------------------------------------------

/**
 * Records metered consumption. Fire-and-forget by design: the work has already
 * happened, and failing to *count* a sent message must not fail the send.
 */
export async function trackUsage(
  businessId: string,
  metric: UsageMetric,
  amount = 1
): Promise<void> {
  if (amount <= 0) return
  const admin = getDb()
  const { error } = await admin.rpc('passimo_track_usage', {
    p_business_id: businessId,
    p_metric: USAGE_METRICS[metric],
    p_amount: amount,
  })
  if (error) {
    logger.warn('entitlements.track_usage_failed', { business_id: businessId, metric, error })
  }
}

/**
 * The gate for metered actions: check the cap, run the work, then count it.
 *
 * Counting *after* success means a provider outage does not burn the merchant's
 * quota, and the check-then-act window is acceptable because the cost of
 * briefly exceeding a soft quota is zero.
 */
export async function meterAction<T>(
  businessId: string,
  metric: UsageMetric,
  amount: number,
  action: () => Promise<T>
): Promise<T> {
  await requireWithinLimit(businessId, USAGE_METRICS[metric], amount)
  const result = await action()
  await trackUsage(businessId, metric, amount)
  return result
}

// -----------------------------------------------------------------------------
// Reporting
// -----------------------------------------------------------------------------

export type BillingSummary = Entitlements & {
  usage: LimitStatus[]
  /** Limits at or past 80%, newest problem first. Drives the dashboard nudge. */
  pressure: LimitStatus[]
}

/** Everything the billing screen and the plan badge need, in one round trip. */
export async function getBillingSummary(businessId: string): Promise<BillingSummary> {
  const entitlements = await getEntitlements(businessId)
  const keys = Object.keys(entitlements.limits) as LimitKey[]
  const usage = await Promise.all(keys.map((key) => measureLimit(businessId, key, entitlements)))

  return {
    ...entitlements,
    usage,
    pressure: usage
      .filter((status) => status.approaching)
      .sort((a, b) => b.ratio - a.ratio),
  }
}

/** Applies a plan change and clears the memo. Used by the webhook and by admin tooling. */
export async function applyPlan(
  businessId: string,
  patch: {
    plan?: PlanId
    interval?: 'month' | 'year'
    status?: string | null
    currentPeriodEnd?: string | null
    cancelAtPeriodEnd?: boolean
    stripeCustomerId?: string | null
    stripeSubscriptionId?: string | null
    trialEndsAt?: string | null
  }
): Promise<void> {
  const admin = getDb()
  const update: Record<string, unknown> = {}

  if (patch.plan !== undefined) update.plan = patch.plan
  if (patch.interval !== undefined) update.plan_interval = patch.interval
  if (patch.status !== undefined) update.subscription_status = patch.status
  if (patch.currentPeriodEnd !== undefined) {
    update.subscription_current_period_end = patch.currentPeriodEnd
  }
  if (patch.cancelAtPeriodEnd !== undefined) update.cancel_at_period_end = patch.cancelAtPeriodEnd
  if (patch.stripeCustomerId !== undefined) update.stripe_customer_id = patch.stripeCustomerId
  if (patch.stripeSubscriptionId !== undefined) {
    update.stripe_subscription_id = patch.stripeSubscriptionId
  }
  if (patch.trialEndsAt !== undefined) update.trial_ends_at = patch.trialEndsAt

  if (Object.keys(update).length === 0) return

  const { error } = await admin.from('businesses').update(update).eq('id', businessId)
  if (error) {
    logger.error('entitlements.apply_plan_failed', { business_id: businessId, error })
    throw error
  }
  invalidateEntitlements(businessId)
}

export { DEFAULT_TRIAL_DAYS }
