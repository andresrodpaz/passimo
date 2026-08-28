import { defineRoute } from '@/lib/api/handler'
import { businessIdSchema } from '@/lib/api/schemas'
import {
  cardDesignPatchSchema,
  cardDesignTemplateSchema,
  payloadOf,
} from '@/lib/api/wallet-schemas'
import { getDb } from '@/lib/db'
import { notFound, unprocessable } from '@/lib/errors'
import { recordAudit } from '@/lib/audit'
import { getBrandKit } from '@/lib/brand/store'
import {
  applyCardDesignTemplate,
  getCardDesign,
  updateCardDesign,
} from '@/lib/wallet/card-design-store'
import { walletService } from '@/lib/wallet/service'
import { scheduleBusinessWalletSync } from '@/lib/wallet/sync'
import { num } from '@/lib/domain/types'

export const runtime = 'nodejs'

/**
 * The card designer's endpoint.
 *
 * `wallet_card_designs` and the whole resolution model existed before this route
 * did — `buildPassContent` has been reading them since migration 21 — but there
 * was no way for a merchant to *write* one. The designer component was built,
 * the templates were written, the translations were shipped, and the loop was
 * never closed: every business on the platform silently used the default design
 * because nothing could save anything else.
 *
 * GET returns everything the screen needs in one round trip — the saved design,
 * the brand kit it inherits from, the merchant's real program so the preview
 * shows their own numbers and units, and their default location's name. Loading
 * a designer that previews "Sample Business / 8 points" while the merchant's
 * actual card says "Panadería Sol / 6 sellos" is a preview nobody trusts.
 */

type ProgramRow = {
  name: string | null
  type: string | null
  unit_singular: string | null
  unit_plural: string | null
  goal_amount: number | string | null
  reward_description: string | null
}

export const GET = defineRoute(
  {
    name: 'wallet.design.read',
    auth: 'required',
    query: businessIdSchema,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['wallet:read'],
    rateLimit: 'dashboard',
  },
  async ({ business }) => {
    const admin = getDb()
    const businessId = business.businessId

    const [design, brand, { data: programRow }, { data: locationRow }] = await Promise.all([
      getCardDesign(businessId),
      getBrandKit(businessId),
      admin
        .from('loyalty_programs')
        .select('name, type, unit_singular, unit_plural, goal_amount, reward_description')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .limit(1)
        .maybeSingle<ProgramRow>(),
      admin
        .from('locations')
        .select('name')
        .eq('business_id', businessId)
        .is('archived_at', null)
        .order('is_default', { ascending: false })
        .limit(1)
        .maybeSingle<{ name: string | null }>(),
    ])

    if (!brand) throw notFound('Business')

    const goalAmount = programRow?.goal_amount == null ? null : num(programRow.goal_amount)

    return {
      design,
      brand,
      program: {
        name: programRow?.name ?? null,
        /*
         * The program *type*, not the unit label. A Spanish café's unit is
         * "sellos", so classifying by the word would treat every localised stamp
         * card as a points program and stop the preview drawing stamps — the
         * same bug `pass-content.ts` documents avoiding on the server side.
         */
        isStampProgram: programRow?.type === 'stamps',
        goal: goalAmount && goalAmount > 0 ? goalAmount : null,
        unitSingular: programRow?.unit_singular ?? null,
        unitPlural: programRow?.unit_plural ?? null,
        rewardName: programRow?.reward_description ?? null,
      },
      locationName: locationRow?.name ?? null,
      /*
       * Provider status travels with the design so the screen can say "this is a
       * preview, passes are not issuing on this deployment yet" honestly rather
       * than implying the merchant is about to ship a real Apple pass.
       */
      providers: walletService().status(),
    }
  }
)

export const PATCH = defineRoute(
  {
    name: 'wallet.design.update',
    auth: 'required',
    body: cardDesignPatchSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['wallet:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    const patch = payloadOf(body)
    if (Object.keys(patch).length === 0) throw unprocessable('Nothing to update')

    const design = await updateCardDesign(business.businessId, patch)

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'wallet.card_design_updated',
      resourceType: 'business',
      resourceId: business.businessId,
      summary: `Updated card design: ${Object.keys(patch).join(', ')}`,
      request,
    })

    /*
     * Every field on this record is on the face of the card, so any change here
     * affects installed passes — unlike the brand kit, where a phone number can
     * change without repainting anything. No conditional: there is nothing in
     * this table that a customer does not see.
     */
    await scheduleBusinessWalletSync(business.businessId, 'settings_changed')

    return { design }
  }
)

/**
 * Applies a template.
 *
 * A separate verb rather than a PATCH carrying fifteen fields, because it is a
 * different intent: PATCH is "I changed this one thing", POST here is "start me
 * over from this design". The store preserves the merchant's own copy and logo
 * across the change, so clicking through templates to compare them cannot lose
 * the sentence they wrote.
 */
export const POST = defineRoute(
  {
    name: 'wallet.design.apply_template',
    auth: 'required',
    body: cardDesignTemplateSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['wallet:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    const design = await applyCardDesignTemplate(business.businessId, body.template)
    if (!design) throw notFound('Card template')

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'wallet.card_template_applied',
      resourceType: 'business',
      resourceId: business.businessId,
      summary: `Applied card template ${body.template}`,
      request,
    })

    await scheduleBusinessWalletSync(business.businessId, 'settings_changed')

    return { design }
  }
)
