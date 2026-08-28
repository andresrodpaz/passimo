import { defineRoute } from '@/lib/api/handler'
import { businessIdSchema } from '@/lib/api/schemas'
import { payloadOf, walletSettingsPatchSchema } from '@/lib/api/wallet-schemas'
import { recordAudit } from '@/lib/audit'
import { hasFeature } from '@/lib/billing/entitlements'
import { getWalletSettings, updateWalletSettings } from '@/lib/wallet/settings'
import { walletService } from '@/lib/wallet/service'
import { scheduleBusinessWalletSync } from '@/lib/wallet/sync'
import { listLocations } from '@/lib/wallet/locations'
import { WALLET_TEMPLATES } from '@/lib/wallet/templates'
import { getTranslator } from '@/lib/i18n/server'

export const runtime = 'nodejs'

/**
 * Merchant wallet configuration.
 *
 * The GET returns everything the wallet screen needs in one round trip: the
 * merchant's settings, which providers are actually configured on this deployment
 * and what they are missing, which proximity features their plan includes, and the
 * template gallery. Six requests to render one screen is how a settings page ends
 * up feeling slow.
 *
 * Provider status is deliberately part of the response. A merchant whose Apple
 * certificate has not been installed should see *"Apple Wallet — not configured,
 * missing APPLE_SIGNING_CERTIFICATE_PATH"*, not a toggle that silently does
 * nothing.
 */
export const GET = defineRoute(
  {
    name: 'wallet.settings.read',
    auth: 'required',
    query: businessIdSchema,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['wallet:read'],
    rateLimit: 'dashboard',
  },
  async ({ business }) => {
    const [settings, locations, geofencing, proximityCampaigns, automationRules, t] =
      await Promise.all([
        getWalletSettings(business.businessId),
        listLocations(business.businessId),
        hasFeature(business.businessId, 'geofencing'),
        hasFeature(business.businessId, 'proximity_campaigns'),
        hasFeature(business.businessId, 'automation_rules'),
        getTranslator(),
      ])

    return {
      settings,
      providers: walletService().status(),
      entitlements: { geofencing, proximity_campaigns: proximityCampaigns, automation_rules: automationRules },
      /*
       * Locations are returned with the settings because every geofence value is
       * meaningless without them: a merchant reading "default radius 200 m" needs
       * to see which of their sites overrides it.
       */
      locations: locations.map((location) => ({
        id: location.id,
        name: location.name,
        city: location.city,
        isDefault: location.isDefault,
        isVisible: location.isVisible,
        hasCoordinates: Boolean(location.coordinates),
        geofence: location.geofence,
      })),
      // Gallery copy in the viewer's language. The business's language is what
      // matters when a template is *applied*, not when it is browsed.
      templates: WALLET_TEMPLATES.map((template) => ({
        key: template.key,
        name: t(template.nameKey),
        summary: t(template.summaryKey),
        emoji: template.emoji,
        campaigns: template.campaigns.length,
        rules: template.rules.length,
        settings: template.settings,
      })),
    }
  }
)

export const PATCH = defineRoute(
  {
    name: 'wallet.settings.update',
    auth: 'required',
    body: walletSettingsPatchSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['wallet:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    const patch = payloadOf(body)
    const settings = await updateWalletSettings(business.businessId, patch)

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'wallet.settings_updated',
      resourceType: 'business',
      resourceId: business.businessId,
      summary: `Updated wallet settings: ${Object.keys(patch).join(', ')}`,
      request,
    })

    // Branding, relevance caps and the dynamic-content switch all change what an
    // installed pass renders, so the change has to reach cards already in wallets.
    const affectsPasses = [
      'brandColor',
      'brandTextColor',
      'logoUrl',
      'heroImageUrl',
      'maxRelevantLocations',
      'dynamicPassContent',
      'appleLockScreenSuggestions',
      'googleWalletSuggestions',
      'proximityEnabled',
      'passExpirationDays',
    ].some((key) => key in patch)

    if (affectsPasses) {
      await scheduleBusinessWalletSync(business.businessId, 'settings_changed')
    }

    return { settings }
  }
)
