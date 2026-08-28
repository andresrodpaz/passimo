import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { recordAudit } from '@/lib/audit'
import { env } from '@/lib/env'
import {
  getAdvocates,
  getMerchantReferralSummary,
  getReferralProgram,
  getReferralStats,
  updateReferralProgram,
} from '@/lib/growth/referrals'
import { getReputationSummary, listFeedback, resolveFeedback } from '@/lib/growth/reputation'

export const runtime = 'nodejs'

const growthQuery = z.object({
  businessId: z.string().uuid(),
  days: z.coerce.number().int().min(7).max(365).default(90),
})

/**
 * Everything the Grow screen needs, in one request.
 *
 * Referrals, reputation and the share assets are one page because they are one
 * job — "get more customers through the people I already have" — and splitting
 * them into three screens is how each gets visited once and never again.
 */
export const GET = defineRoute(
  {
    name: 'growth.summary',
    auth: 'required',
    query: growthQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['analytics:read'],
    rateLimit: 'dashboard',
  },
  async ({ query, business }) => {
    const admin = getDb()

    const [referrals, advocates, program, reputation, unresolved, merchantReferral, record] =
      await Promise.all([
        getReferralStats(business.businessId, query.days),
        getAdvocates(business.businessId, 10),
        getReferralProgram(business.businessId),
        getReputationSummary(business.businessId, query.days),
        listFeedback(business.businessId, {
          category: 'detractor',
          unresolvedOnly: true,
          limit: 20,
        }),
        getMerchantReferralSummary(business.businessId),
        admin
          .from('businesses')
          .select('slug, google_review_url, instagram')
          .eq('id', business.businessId)
          .maybeSingle(),
      ])

    const slug = (record.data?.slug as string) ?? ''

    return {
      referrals,
      advocates,
      program,
      reputation,
      unresolved_feedback: unresolved.feedback,
      merchant_referral: merchantReferral,
      assets: {
        join_url: `${env.appUrl}/join/${slug}`,
        gift_url: `${env.appUrl}/gift/${slug}`,
        qr_url: `${env.appUrl}/api/v1/public/qr?data=${encodeURIComponent(`${env.appUrl}/join/${slug}`)}&size=1024&download=1`,
        google_review_url: (record.data?.google_review_url as string) ?? null,
        instagram: (record.data?.instagram as string) ?? null,
      },
    }
  }
)

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('update_referral_program'),
    businessId: z.string().uuid(),
    advocateReward: z.number().min(0).max(10_000),
    friendReward: z.number().min(0).max(10_000),
    isActive: z.boolean(),
  }),
  z.object({
    action: z.literal('resolve_feedback'),
    businessId: z.string().uuid(),
    feedbackId: z.string().uuid(),
    note: z.string().min(1).max(1000),
  }),
])

export const POST = defineRoute(
  {
    name: 'growth.action',
    auth: 'required',
    body: bodySchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['programs:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, actor, business, request }) => {
    switch (body.action) {
      case 'update_referral_program': {
        const program = await updateReferralProgram({
          businessId: business.businessId,
          advocateReward: body.advocateReward,
          friendReward: body.friendReward,
          isActive: body.isActive,
        })
        await recordAudit({
          businessId: business.businessId,
          actor,
          action: 'referral_program.updated',
          summary: `Referral rewards set to ${body.advocateReward} / ${body.friendReward}`,
          request,
        })
        return { program }
      }

      case 'resolve_feedback': {
        const result = await resolveFeedback({
          businessId: business.businessId,
          feedbackId: body.feedbackId,
          note: body.note,
          userId: actor.kind === 'user' ? actor.id : null,
        })
        await recordAudit({
          businessId: business.businessId,
          actor,
          action: 'feedback.resolved',
          resourceType: 'survey_response',
          resourceId: body.feedbackId,
          summary: 'Resolved unhappy customer feedback',
          request,
        })
        return result
      }
    }
  }
)
