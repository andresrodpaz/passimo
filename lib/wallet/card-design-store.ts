import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import {
  CARD_DESIGN_COLUMNS,
  DEFAULT_CARD_DESIGN,
  mapCardDesign,
  normalizeHex,
  type CardDesign,
} from '@/lib/wallet/card-design'
import { applyCardTemplate, findCardTemplate } from '@/lib/wallet/card-templates'

/**
 * Reads and writes `wallet_card_designs`.
 *
 * Kept apart from `card-design.ts` because that module is isomorphic — the live
 * preview imports it in the browser — and a `server-only` import there would
 * break the designer. The rules live there; the persistence lives here.
 *
 * A business with no row has the default design. That is returned rather than
 * null so no caller and no screen ever handles an "unconfigured" state, matching
 * how `wallet_settings` behaves.
 */

export async function getCardDesign(businessId: string): Promise<CardDesign> {
  const admin = getDb()
  const { data, error } = await admin
    .from('wallet_card_designs')
    .select('*')
    .eq('business_id', businessId)
    .maybeSingle()

  if (error) {
    /*
     * A design read failure must not fail a pass download. The card falls back
     * to the brand kit, which is what an unconfigured business gets anyway — a
     * customer at a counter should never be told their card is unavailable
     * because a styling table was briefly unreachable.
     */
    logger.warn('wallet.card_design_read_failed', { business_id: businessId, error })
    return { ...DEFAULT_CARD_DESIGN }
  }

  return mapCardDesign(data)
}

export type CardDesignPatch = Partial<CardDesign>

/**
 * Writes a partial design.
 *
 * Colours are normalised rather than trusted: the value arrives from a colour
 * input, but also from the API, and `background-color: red; content: …` reaching
 * a style attribute is not a risk worth carrying for a hex field.
 */
export async function updateCardDesign(
  businessId: string,
  patch: CardDesignPatch
): Promise<CardDesign> {
  const update: Record<string, unknown> = { business_id: businessId }
  const colorFields = new Set(['backgroundColor', 'foregroundColor', 'accentColor'])

  for (const [field, column] of Object.entries(CARD_DESIGN_COLUMNS) as Array<
    [keyof CardDesign, string]
  >) {
    const value = patch[field]
    if (value === undefined) continue

    if (colorFields.has(field)) {
      // Null clears the override and returns the card to the brand colour.
      update[column] = value === null ? null : normalizeHex(value)
      continue
    }

    if (typeof value === 'string') {
      const trimmed = value.trim()
      update[column] = trimmed.length > 0 ? trimmed : null
      continue
    }

    update[column] = value
  }

  const admin = getDb()
  const { error } = await admin
    .from('wallet_card_designs')
    .upsert(update, { onConflict: 'business_id' })

  if (error) throw error
  return getCardDesign(businessId)
}

/**
 * Applies a template, preserving the merchant's own copy and logo.
 *
 * Reads the current design first so `applyCardTemplate` can carry those forward.
 * The extra round trip is worth it: a merchant clicking through templates to
 * compare them must not lose the sentence they wrote on the back.
 */
export async function applyCardDesignTemplate(
  businessId: string,
  templateKey: string
): Promise<CardDesign | null> {
  const template = findCardTemplate(templateKey)
  if (!template) return null

  const current = await getCardDesign(businessId)
  const next = applyCardTemplate(current, template)

  const admin = getDb()
  const { error } = await admin.from('wallet_card_designs').upsert(
    {
      business_id: businessId,
      template: next.template,
      card_style: next.cardStyle,
      progress_style: next.progressStyle,
      typography: next.typography,
      background_color: next.backgroundColor,
      foreground_color: next.foregroundColor,
      accent_color: next.accentColor,
      show_member_name: next.showMemberName,
      show_member_since: next.showMemberSince,
      show_tier: next.showTier,
      show_location: next.showLocation,
      show_reward: next.showReward,
      show_progress: next.showProgress,
      applied_template_at: new Date().toISOString(),
    },
    { onConflict: 'business_id' }
  )

  if (error) throw error
  return getCardDesign(businessId)
}
