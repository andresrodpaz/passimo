import 'server-only'
import { getDb } from '@/lib/db'
import { env } from '@/lib/env'
import { signToken } from '@/lib/crypto'
import { num } from '@/lib/domain/types'
import { logger } from '@/lib/logger'
import type { LatLng } from '@/lib/wallet/geo'
import { relevantLocationsFor } from '@/lib/wallet/locations'
import { getWalletSettings } from '@/lib/wallet/settings'
import { getCardDesign } from '@/lib/wallet/card-design-store'
import { resolveCardDesign } from '@/lib/wallet/card-design'
import { BRAND_KIT_COLUMNS, mapBrandKit } from '@/lib/brand/kit'
import { getBusinessLocale } from '@/lib/i18n/business'
import { createTranslator, type Translator } from '@/lib/i18n/translate'
import { formatPassMonthYear, passLocaleTag } from '@/lib/wallet/pass-format'
import type {
  PassLabels,
  PassOffer,
  RelevantLocation,
  StoreLocation,
  WalletPassContent,
  WalletSettings,
} from '@/lib/wallet/types'

/**
 * Builds the provider-agnostic content of a customer's card.
 *
 * This is the one place that answers "what does this card say right now", and
 * both wallet providers render from its output. Adding a field is therefore a
 * single change that lands on iPhone and Android simultaneously — the alternative
 * (each provider assembling its own view of loyalty state) is how the two halves
 * of a loyalty product drift until a merchant is told two different balances by
 * two customers standing next to each other.
 *
 * Everything merchant-configurable is applied here too, so a provider never has
 * to know what `dynamicPassContent` or `appleLockScreenSuggestions` mean.
 */

export type BuildPassContentOptions = {
  /** Order relevant locations by proximity to this point, when known. */
  near?: LatLng | null
  /** Reuse an already-loaded settings row. */
  settings?: WalletSettings
}

type CustomerRow = {
  id: string
  business_id: string
  name: string | null
  first_name: string | null
  last_name: string | null
  created_at: string
  referral_code: string | null
  wallet_auth_token: string | null
  status: string
  is_vip: boolean | null
}

export async function buildPassContent(
  customerId: string,
  options: BuildPassContentOptions = {}
): Promise<WalletPassContent | null> {
  const admin = getDb()

  const { data: customer } = await admin
    .from('customers')
    .select(
      'id, business_id, name, first_name, last_name, created_at, referral_code, wallet_auth_token, status, is_vip'
    )
    .eq('id', customerId)
    .maybeSingle<CustomerRow>()

  if (!customer || customer.status !== 'active') return null

  const businessId = customer.business_id
  const settings = options.settings ?? (await getWalletSettings(businessId))
  // The business's language, not a request's. Everything this function produces
  // is read by a customer on their own phone, possibly weeks later. The locale
  // itself is kept, not just the translator, because dates on the card have to
  // be formatted with the same language the labels are written in.
  const locale = await getBusinessLocale(businessId)
  const t = createTranslator(locale)
  const localeTag = passLocaleTag(locale)

  const [{ data: business }, { data: accounts }, locations, offers, cardDesign] = await Promise.all([
    admin
      .from('businesses')
      .select(`${BRAND_KIT_COLUMNS}, slug, locale`)
      .eq('id', businessId)
      .maybeSingle(),
    admin
      .from('loyalty_accounts')
      .select(
        'balance, next_expiry_at, loyalty_programs:program_id (name, type, unit_singular, unit_plural, goal_amount, reward_description, is_default), program_tiers:tier_id (name, level)'
      )
      .eq('customer_id', customerId),
    // Proximity switched off means an ordinary pass with no locations, not a
    // failed pass: the card must still install and still work at the counter.
    settings.proximityEnabled
      ? relevantLocationsFor(businessId, {
          near: options.near ?? null,
          limit: settings.maxRelevantLocations,
        })
      : Promise.resolve([] as StoreLocation[]),
    loadOffers(businessId, customerId, t),
    getCardDesign(businessId),
  ])

  if (!business) return null

  const primary =
    (accounts ?? []).find(
      (row) => (row.loyalty_programs as unknown as { is_default?: boolean } | null)?.is_default
    ) ?? (accounts ?? [])[0]

  const program = primary?.loyalty_programs as unknown as
    | {
        name?: string
        type?: string
        unit_singular?: string
        unit_plural?: string
        goal_amount?: number | null
        reward_description?: string | null
      }
    | undefined
  const tier = primary?.program_tiers as unknown as { name?: string; level?: number } | null

  const balance = num(primary?.balance)
  const goal = program?.goal_amount ? num(program.goal_amount) : null
  const rewardReady = goal !== null && balance >= goal
  // A merchant's own unit word always wins; the fallback is only reached by a
  // program created before units existed, and even then it must be in their
  // language rather than in ours.
  const unitPlural = program?.unit_plural ?? t('wallet.pass.unitFallback')
  const unitSingular = program?.unit_singular ?? unitPlural.replace(/s$/, '')

  const authenticationToken = await ensureAuthToken(customer)
  const cardToken = signToken('card', { c: customer.id }, 60 * 60 * 24 * 365)

  const businessName = (business.name as string) ?? 'Loyalty'

  /*
   * The card face is resolved from the brand kit and the merchant's design, in
   * that order. `wallet_settings.brand_color` is deliberately *not* consulted:
   * it used to override this and gave one decision two homes, which migration 21
   * fixed by copying any such value into the design row. Notification branding —
   * the emoji, title and copy of a lock-screen alert — still lives in settings,
   * because that is behaviour rather than identity.
   */
  const rewardName = program?.reward_description ?? null

  const brand = mapBrandKit(business)
  const design = resolveCardDesign(cardDesign, brand, {
    goal,
    // `loyalty_programs.type` rather than the unit label: a Spanish café's unit
    // is "sellos", so matching on the word would classify every localised stamp
    // card as a points program and quietly stop drawing stamps.
    isStampProgram: program?.type === 'stamps',
  })

  return {
    serialNumber: customer.id,
    customerId: customer.id,
    businessId,
    authenticationToken,

    // A merchant's own name always beats a deployment-wide default; the env var
    // exists only for white-label installs that must show one issuer.
    organizationName: businessName || env.apple.organizationName || 'Passimo',
    // The merchant's own card title wins over the program name — it is the line
    // their customer reads first, and the only headline they get to write.
    programName:
      design.headline ?? program?.name ?? t('wallet.pass.programName', { business: businessName }),
    description: t('wallet.pass.description', { business: businessName }),

    labels: buildPassLabels(t, {
      locale,
      localeTag,
      businessName,
      goal,
      unitPlural,
      rewardName,
      referralCode: customer.referral_code ?? null,
    }),

    branding: {
      backgroundColor: design.backgroundColor,
      foregroundColor: design.foregroundColor,
      labelColor: design.accentColor,
      logoUrl: design.logoUrl,
      heroImageUrl: design.heroImageUrl,
    },

    design,

    member: {
      name: customer.first_name ?? customer.name ?? null,
      since: formatPassMonthYear(customer.created_at, localeTag),
      tierName: tier?.name ?? null,
      isVip: Boolean(customer.is_vip),
    },

    progress: {
      balance,
      goal,
      unitSingular,
      unitPlural,
      rewardName,
      rewardReady,
      remaining: goal !== null ? Math.max(0, goal - balance) : null,
      expiresAt: (primary?.next_expiry_at as string) ?? null,
    },

    relevantLocations: settings.proximityEnabled
      ? locations.map((location) =>
          toRelevantLocation(location, {
            businessName,
            rewardReady,
            rewardName,
            settings,
            t,
          })
        )
      : [],

    // Dynamic content off means a static card: balance and reward only. Some
    // merchants genuinely want that — a card that never changes is a card that
    // never surprises a customer — so it is a real setting, not a debug flag.
    offers: settings.dynamicPassContent ? offers : [],

    links: {
      cardUrl: `${env.appUrl}/card/${cardToken}`,
      webServiceUrl: env.apple.webServiceUrl,
      websiteUrl: (business.website as string) ?? null,
      supportEmail: (business.support_email as string) ?? null,
    },

    referralCode: customer.referral_code ?? null,
    expiresAt: settings.passExpirationDays
      ? new Date(Date.now() + settings.passExpirationDays * 86_400_000).toISOString()
      : null,
  }
}

/**
 * Resolves the card's fixed vocabulary once, for both providers.
 *
 * The three entries that depend on loyalty state — the "how it works"
 * paragraph, the referral line and the balance-change message — are
 * interpolated here rather than in the providers, because the wording differs
 * between an open-ended points program and one with a goal, and that is a
 * content decision rather than an Apple or Google one.
 */
export function buildPassLabels(
  t: Translator,
  context: {
    locale: string
    localeTag: string
    businessName: string
    goal: number | null
    unitPlural: string
    rewardName: string | null
    referralCode: string | null
  }
): PassLabels {
  const { goal, unitPlural, rewardName, referralCode } = context

  return {
    localeTag: context.localeTag,
    language: context.locale,

    tier: t('wallet.pass.tier'),
    vip: t('wallet.pass.vip'),
    balanceChange: t('wallet.pass.balanceChange', { unit: unitPlural }),
    readyToClaim: t('wallet.pass.readyToClaim'),
    nextReward: t('wallet.pass.nextReward'),
    rewardFallback: t('wallet.pass.rewardFallback'),
    toGo: t('wallet.pass.toGo'),
    member: t('wallet.pass.member'),
    since: t('wallet.pass.since'),
    howItWorks: t('wallet.pass.howItWorks'),
    howItWorksBody:
      goal && goal > 0
        ? t('wallet.pass.howItWorksGoal', {
            goal: String(goal),
            unit: unitPlural,
            reward: rewardName ?? t('wallet.pass.yourReward'),
          })
        : t('wallet.pass.howItWorksOpen', { unit: unitPlural }),
    offer: t('wallet.pass.offer'),
    offerUntil: t('wallet.pass.offerUntil'),
    where: t('wallet.pass.where'),
    referral: t('wallet.pass.referral'),
    referralBody: referralCode
      ? t('wallet.pass.referralBody', { code: referralCode })
      : '',
    referralBodyShort: referralCode
      ? t('wallet.pass.referralBodyShort', { code: referralCode })
      : '',
    pointsExpire: t('wallet.pass.pointsExpire', { unit: unitPlural }),
    website: t('wallet.pass.website'),
    contact: t('wallet.pass.contact'),
    manageCard: t('wallet.pass.manageCard'),
    viewCard: t('wallet.pass.viewCard'),
    goal: t('wallet.pass.goal'),
    memberFallback: t('wallet.pass.memberFallback'),
    logoAlt: t('wallet.pass.logoAlt', { name: context.businessName }),
  }
}

/**
 * Maps a store location to the relevance entry a pass carries.
 *
 * The lock-screen line is chosen, in order: the merchant's own copy for that
 * site, the merchant's business-wide copy, then a generated line that changes
 * when a reward is claimable. That last case matters more than it looks —
 * *"Your free coffee is waiting at Gran Vía"* on a lock screen is the single
 * highest-converting string in the product.
 *
 * Which is exactly why it is translated. The generated fallback was two English
 * literals, so a Spanish café whose merchant had not written their own copy —
 * the default state — pushed English to every customer's lock screen, on the
 * highest-value surface the product has, with no way to correct it from the
 * dashboard. `t` is the *business's* translator, not the viewer's: this string
 * is read by a customer standing outside a shop, long after any request.
 */
export function toRelevantLocation(
  location: StoreLocation,
  context: {
    businessName: string
    rewardReady: boolean
    rewardName: string | null
    settings: WalletSettings
    t: Translator
  }
): RelevantLocation {
  const name = location.name || context.businessName
  const generated = context.rewardReady
    ? context.t('wallet.relevance.rewardWaiting', {
        reward: context.rewardName ?? context.t('wallet.relevance.yourReward'),
        location: name,
      })
    : context.t('wallet.relevance.nearby', { location: name })

  return {
    id: location.id,
    name,
    coordinates: location.coordinates!,
    radiusMeters: location.geofence.relevanceRadiusMeters,
    relevantText: location.relevantText ?? context.settings.branding.message ?? generated,
    beacon: context.settings.beaconsEnabled ? location.beacon : null,
  }
}

/**
 * Offers currently available to this customer.
 *
 * Claimed-but-unredeemed rewards first: those are things the customer has already
 * earned and might have forgotten, which is exactly what the back of a card is
 * for. Partner offers come second because they are someone else's business.
 */
async function loadOffers(
  businessId: string,
  customerId: string,
  t: Translator
): Promise<PassOffer[]> {
  const admin = getDb()
  try {
    const [{ data: claims }, { data: partnerOffers }] = await Promise.all([
      admin
        .from('reward_redemptions')
        .select('id, expires_at, rewards:reward_id (name, description)')
        .eq('business_id', businessId)
        .eq('customer_id', customerId)
        .eq('status', 'claimed')
        .limit(5),
      admin
        .from('coalition_offers')
        .select('id, title, description, ends_at')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .limit(3),
    ])

    const fromClaims: PassOffer[] = (claims ?? []).map((claim) => {
      const reward = claim.rewards as unknown as { name?: string; description?: string } | null
      return {
        id: claim.id as string,
        title: reward?.name ?? t('wallet.pass.rewardReadyTitle'),
        description: reward?.description ?? null,
        expiresAt: (claim.expires_at as string) ?? null,
      }
    })

    const fromPartners: PassOffer[] = (partnerOffers ?? []).map((offer) => ({
      id: offer.id as string,
      title: offer.title as string,
      description: (offer.description as string) ?? null,
      expiresAt: (offer.ends_at as string) ?? null,
    }))

    return [...fromClaims, ...fromPartners].slice(0, 6)
  } catch (cause) {
    // The back of the card is a nice-to-have; a pass without offers still works.
    logger.warn('wallet.offers_read_failed', { business_id: businessId, cause })
    return []
  }
}

/** Every pass needs a stable per-pass secret for the update web service. */
async function ensureAuthToken(customer: CustomerRow): Promise<string> {
  if (customer.wallet_auth_token) return customer.wallet_auth_token
  const token = crypto.randomUUID().replace(/-/g, '')
  const admin = getDb()
  await admin.from('customers').update({ wallet_auth_token: token }).eq('id', customer.id)
  return token
}

/*
 * "Member since" used to be formatted by a private helper here, hardcoded to
 * `en-GB`. It now goes through `formatPassMonthYear` in `pass-format.ts`, which
 * both providers also use for offer and expiry dates — so the card cannot print
 * one date in the business's language and another in ours.
 */
