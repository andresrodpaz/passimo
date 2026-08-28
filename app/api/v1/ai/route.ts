import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { env } from '@/lib/env'
import { badRequest } from '@/lib/errors'
import {
  analyzeFeedback,
  buildBusinessSnapshot,
  generateCampaign,
  generateInsights,
  generateSegment,
  optimizeProgram,
  rewriteCopy,
  summarizeCustomer,
} from '@/lib/ai/capabilities'
import { countSegment } from '@/lib/segments/resolve'
import { getDb } from '@/lib/db'
import { recordAudit } from '@/lib/audit'
import { meterAction } from '@/lib/billing/entitlements'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Single AI endpoint with a discriminated `action`.
 *
 * One route means one rate limit, one permission check and one place where AI
 * spend is governed — rather than eight near-identical endpoints that each
 * need to remember all three.
 */
const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('campaign'),
    businessId: z.string().uuid(),
    brief: z.string().min(3).max(1000),
  }),
  z.object({ action: z.literal('insights'), businessId: z.string().uuid() }),
  z.object({
    action: z.literal('segment'),
    businessId: z.string().uuid(),
    request: z.string().min(3).max(500),
  }),
  z.object({ action: z.literal('optimize_program'), businessId: z.string().uuid() }),
  z.object({
    action: z.literal('customer_summary'),
    businessId: z.string().uuid(),
    customerId: z.string().uuid(),
  }),
  z.object({ action: z.literal('feedback_themes'), businessId: z.string().uuid() }),
  z.object({
    action: z.literal('rewrite'),
    businessId: z.string().uuid(),
    text: z.string().min(1).max(5000),
    instruction: z.string().min(2).max(300),
    channel: z.enum(['email', 'sms', 'whatsapp', 'push']),
  }),
])

export const POST = defineRoute(
  {
    name: 'ai',
    auth: 'required',
    body: bodySchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['ai:use'],
    feature: 'ai',
    rateLimit: 'ai',
    requires: () => env.ai.isConfigured,
    requiresLabel: 'AI features',
  },
  async ({ body, actor, business, request }) =>
    /*
     * One action, one unit, counted only after the model answered. Metering
     * here rather than inside each capability means a new AI feature is
     * governed by construction, and a provider outage never burns the
     * merchant's monthly allowance.
     */
    meterAction(business.businessId, 'ai_actions', 1, async () => {
      switch (body.action) {
      case 'campaign': {
        const result = await generateCampaign(business.businessId, body.brief)
        await recordAudit({
          businessId: business.businessId,
          actor,
          action: 'ai.campaign_generated',
          summary: body.brief.slice(0, 120),
          request,
        })
        return { campaign: result }
      }

      case 'insights': {
        const snapshot = await buildBusinessSnapshot(business.businessId)
        const insights = await generateInsights(business.businessId, snapshot)

        // Persist so the feed survives a refresh and can be dismissed.
        const admin = getDb()
        if (insights.length > 0) {
          await admin.from('ai_insights').insert(
            insights.map((insight) => ({
              business_id: business.businessId,
              kind: insight.kind,
              title: insight.title,
              body: insight.body,
              severity: insight.severity,
              estimated_impact: insight.estimated_impact ?? null,
              confidence: insight.confidence,
              action: insight.action ?? null,
              model: env.ai.model,
              expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
            }))
          )
        }
        return { insights }
      }

      case 'segment': {
        const result = await generateSegment(body.request)
        // Show the merchant how many people it actually matches before saving.
        const count = await countSegment(business.businessId, result.definition)
        return { ...result, matching_customers: count }
      }

      case 'optimize_program':
        return { optimization: await optimizeProgram(business.businessId) }

      case 'customer_summary':
        return { summary: await summarizeCustomer(business.businessId, body.customerId) }

      case 'feedback_themes': {
        const analysis = await analyzeFeedback(business.businessId)
        if (!analysis) return { analysis: null, reason: 'no_comments_yet' }
        return { analysis }
      }

      case 'rewrite':
        return {
          text: await rewriteCopy({
            text: body.text,
            instruction: body.instruction,
            channel: body.channel,
          }),
        }

      default:
        throw badRequest('Unknown AI action')
      }
    })
)
