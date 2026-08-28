import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { getPlatformOverview } from '@/lib/admin/platform'
import { errorResponse, json } from '@/lib/http'
import { toAppError } from '@/lib/errors'
import { PLANS, PLAN_ORDER } from '@/lib/billing/plans'
import { WALLET_TEMPLATES } from '@/lib/wallet/templates'
import { getTranslator } from '@/lib/i18n/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The admin console's data.
 *
 * Deliberately outside `defineRoute`. That contract is built around a *business*
 * scope — it resolves `businessIdFrom`, checks a tenant role and a plan
 * entitlement — and none of those concepts apply to a platform operator looking
 * across every tenant. Bolting an "admin" bypass into the tenant contract would
 * mean the single most security-sensitive path in the product shares a code path
 * with the least: one future refactor of `requireBusinessAccess` away from a
 * cross-tenant leak.
 *
 * So platform routes are short, explicit, and start with the one line that
 * matters.
 */
export async function GET() {
  try {
    await requirePlatformAdmin()
    const [overview, t] = await Promise.all([getPlatformOverview(), getTranslator()])

    return json({
      ...overview,
      /*
       * The plan catalogue is served so the console renders the real, current
       * definitions rather than a copy. Plans are code, not tenant data — the
       * console can *see* them and assign them, but changing what a tier includes
       * is a deploy, which is the correct blast radius for a decision that affects
       * every merchant at once.
       */
      plans: PLAN_ORDER.map((id) => ({
        id,
        name: PLANS[id].name,
        taglineKey: PLANS[id].taglineKey,
        monthlyPrice: PLANS[id].monthlyPrice,
        annualPrice: PLANS[id].annualPrice,
        purchasable: PLANS[id].purchasable,
        features: PLANS[id].features,
        limits: PLANS[id].limits,
      })),
      walletTemplates: WALLET_TEMPLATES.map((template) => ({
        key: template.key,
        name: t(template.nameKey),
        emoji: template.emoji,
      })),
    })
  } catch (caught) {
    return errorResponse(toAppError(caught))
  }
}
