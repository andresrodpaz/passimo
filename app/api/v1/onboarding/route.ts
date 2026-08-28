import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import type { ChecklistFacts } from '@/lib/onboarding/checklist'

export const runtime = 'nodejs'

/**
 * Onboarding state and the first-steps checklist.
 *
 * Returns the facts, not the verdict. Which items are shown depends on the plan,
 * and the plan is already resolved on the client by the workspace context — so
 * sending six counts and letting `resolveChecklist` decide keeps the gating rule
 * in one pure, tested function instead of half here and half there.
 *
 * Every count is a `head: true` count: a workspace with 40,000 scans must not
 * pay for a row scan to render a checklist it will dismiss.
 */

const querySchema = z.object({ businessId: z.string().uuid() })

type ChecklistResponse = {
  dismissed: boolean
  /**
   * The wizard step the merchant last reached.
   *
   * A hint, not an instruction. The wizard recomputes which steps are actually
   * outstanding from the account itself and uses this only to avoid sending
   * someone back to a screen they had already moved past — a stored step is
   * exactly the value that goes stale when a merchant deletes the location they
   * just created.
   */
  lastStep: string | null
  /** True once the merchant has activated their card. */
  completed: boolean
  facts: ChecklistFacts
}

export const GET = defineRoute(
  {
    name: 'onboarding.get',
    auth: 'required',
    query: querySchema,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['settings:read'],
    rateLimit: 'dashboard',
  },
  async ({ business }): Promise<ChecklistResponse> => {
    const admin = getDb()
    const businessId = business.businessId

    const [
      { data: state },
      { count: locationCount },
      { count: scanCount },
      { count: campaignCount },
      { count: teamMemberCount },
      { data: walletSettings },
      { data: brand },
    ] = await Promise.all([
      admin
        .from('business_onboarding')
        .select('checklist_dismissed_at, last_step, completed_at')
        .eq('business_id', businessId)
        .maybeSingle(),
      admin
        .from('locations')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .is('archived_at', null),
      /*
       * A "scan" for checklist purposes is a recorded visit or purchase, which
       * is what the counter produces. Counting `activity_events` rather than a
       * scan log means a visit added from a customer profile also counts — the
       * merchant has learned the loop either way.
       */
      admin
        .from('activity_events')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .in('type', ['visit', 'purchase']),
      admin
        .from('campaigns')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .in('status', ['sending', 'completed']),
      admin
        .from('team_members')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId),
      admin
        .from('wallet_settings')
        .select('proximity_enabled, geofencing_enabled')
        .eq('business_id', businessId)
        .maybeSingle(),
      admin
        .from('businesses')
        .select('logo_url, primary_color, accent_color, onboarding_completed_at')
        .eq('id', businessId)
        .maybeSingle(),
    ])

    return {
      dismissed: Boolean(state?.checklist_dismissed_at),
      lastStep: (state?.last_step as string | null) ?? null,
      /*
       * Two places record completion — `businesses.onboarding_completed_at`,
       * written when the card is activated, and `business_onboarding.completed_at`.
       * Either counts: a merchant who finished before the second column existed
       * must not be sent back through the wizard.
       */
      completed: Boolean(brand?.onboarding_completed_at || state?.completed_at),
      facts: {
        locationCount: locationCount ?? 0,
        scanCount: scanCount ?? 0,
        campaignCount: campaignCount ?? 0,
        teamMemberCount: teamMemberCount ?? 0,
        proximityEnabled: Boolean(
          walletSettings?.proximity_enabled && walletSettings?.geofencing_enabled
        ),
        /*
         * "Customised" means they touched it, which is a logo or a colour that is
         * not the one signup wrote. Comparing against the seeded default is the
         * only honest test — a merchant who happens to like our default black has
         * still not personalised anything.
         */
        brandingCustomised: Boolean(
          brand?.logo_url ||
            (brand?.primary_color && brand.primary_color !== DEFAULT_PRIMARY) ||
            (brand?.accent_color && brand.accent_color !== DEFAULT_ACCENT)
        ),
      },
    }
  }
)

/** Matches the defaults `provision_business` writes at signup. */
const DEFAULT_PRIMARY = '#111827'
const DEFAULT_ACCENT = '#f59e0b'

const patchSchema = z.object({
  businessId: z.string().uuid(),
  /** Hide or restore the checklist. Restoring is what Settings will offer. */
  checklistDismissed: z.boolean().optional(),
  /**
   * The wizard step just reached, so a refresh resumes instead of restarting.
   *
   * `location` is the previous name for `shop` and is still accepted. Cursors
   * written before the wizard was renamed are sitting in the database, and
   * `resumeStep` reads them as synonyms — rejecting the old value here would
   * turn one merchant's paused setup into a validation error on their next
   * click, for no gain.
   */
  lastStep: z
    .enum(['program', 'plan', 'shop', 'location', 'card', 'ready'])
    .nullable()
    .optional(),
  completed: z.boolean().optional(),
})

export const PATCH = defineRoute(
  {
    name: 'onboarding.update',
    auth: 'required',
    body: patchSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['settings:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, business }) => {
    const admin = getDb()

    const patch: Record<string, unknown> = { business_id: business.businessId }
    if (body.checklistDismissed !== undefined) {
      patch.checklist_dismissed_at = body.checklistDismissed ? new Date().toISOString() : null
    }
    if (body.lastStep !== undefined) patch.last_step = body.lastStep
    if (body.completed !== undefined) {
      patch.completed_at = body.completed ? new Date().toISOString() : null
    }

    const { error } = await admin
      .from('business_onboarding')
      .upsert(patch, { onConflict: 'business_id' })

    if (error) {
      // A checklist that will not hide is an annoyance, never a blocker — the
      // merchant's actual work is unaffected, so this reports rather than throws.
      logger.warn('onboarding.state_write_failed', { business_id: business.businessId, error })
      return { ok: false }
    }
    return { ok: true }
  }
)
