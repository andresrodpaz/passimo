import { defineRoute } from '@/lib/api/handler'
import { listActorBusinesses } from '@/lib/auth/context'
import { permissionsForRole, type Role } from '@/lib/auth/rbac'
import { capabilityReport } from '@/lib/env'
import { getDb } from '@/lib/db'
import { getEntitlements } from '@/lib/billing/entitlements'

export const runtime = 'nodejs'

/**
 * Bootstrap payload for the dashboard: who am I, which workspaces can I open,
 * what am I allowed to do, what does my plan include, and which integrations
 * are switched on.
 *
 * Returned in one request so the shell renders without a waterfall — and so the
 * navigation knows on first paint whether to show "Memberships" or a lock,
 * rather than flashing one and replacing it with the other.
 */
export const GET = defineRoute(
  { name: 'me', auth: 'required', rateLimit: 'dashboard' },
  async ({ actor }) => {
    const businesses = await listActorBusinesses(actor)
    const active = businesses[0] ?? null

    const admin = getDb()

    // Entitlements are attached per business, not once for "the active one":
    // the client restores its last workspace from localStorage, so a single
    // top-level plan would be wrong for anyone who owns two shops on different
    // tiers. Resolution is memoised for 15s, so this is one query in practice.
    const [unreadNotifications, entitlements] = await Promise.all([
      active && actor.id
        ? admin
            .from('notifications')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', actor.id)
            .is('read_at', null)
            .then(({ count }) => count ?? 0)
        : Promise.resolve(0),
      Promise.all(businesses.map((business) => getEntitlements(business.id))),
    ])

    const byBusiness = new Map(entitlements.map((value) => [value.businessId, value]))

    return {
      user: { id: actor.id, email: actor.email, kind: actor.kind },
      businesses: businesses.map((business) => {
        const plan = byBusiness.get(business.id)
        return {
          ...business,
          permissions: permissionsForRole(business.role as Role),
          entitlements: plan
            ? {
                plan: plan.plan,
                effective_plan: plan.effectivePlan,
                features: [...plan.features],
                limits: plan.limits,
                trial: plan.trial,
                subscription: plan.subscription,
              }
            : null,
        }
      }),
      active_business_id: active?.id ?? null,
      capabilities: capabilityReport(),
      unread_notifications: unreadNotifications,
    }
  }
)
