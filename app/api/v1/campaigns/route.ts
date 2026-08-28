import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { campaignSchema, paginationSchema } from '@/lib/api/schemas'
import { getDb } from '@/lib/db'
import { unprocessable } from '@/lib/errors'
import { recordAudit } from '@/lib/audit'
import { countSegment, resolveSegmentDefinition } from '@/lib/segments/resolve'
import { num } from '@/lib/domain/types'

export const runtime = 'nodejs'

const listQuery = paginationSchema.extend({
  businessId: z.string().uuid(),
  status: z.string().max(20).optional(),
})

export const GET = defineRoute(
  {
    name: 'campaigns.list',
    auth: 'required',
    query: listQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['campaigns:read'],
    rateLimit: 'dashboard',
  },
  async ({ query, business }) => {
    const admin = getDb()
    let request = admin
      .from('campaigns')
      .select(
        'id, name, description, type, status, channels, segment_id, subject, scheduled_at, ' +
          'reach_count, sent_count, delivered_count, failed_count, opened_count, clicked_count, ' +
          'attributed_visits, attributed_revenue, estimated_cost, generated_by_ai, created_at, completed_at',
        { count: 'exact' }
      )
      .eq('business_id', business.businessId)
      .order('created_at', { ascending: false })

    if (query.status) request = request.eq('status', query.status)

    const { data, count, error } = await request.range(
      query.offset,
      query.offset + query.limit - 1
    )
    if (error) throw unprocessable(error.message)

    const rows = (data ?? []) as unknown as Record<string, unknown>[]

    return {
      campaigns: rows.map((row) => ({
        ...row,
        attributed_revenue: num(row.attributed_revenue),
        estimated_cost: num(row.estimated_cost),
        // Open rate is meaningless without a denominator; compute it once here
        // rather than in three different UI components.
        open_rate: num(row.sent_count) ? (num(row.opened_count) / num(row.sent_count)) * 100 : 0,
        click_rate: num(row.sent_count) ? (num(row.clicked_count) / num(row.sent_count)) * 100 : 0,
        roi: num(row.estimated_cost) > 0
          ? (num(row.attributed_revenue) - num(row.estimated_cost)) / num(row.estimated_cost)
          : null,
      })),
      pagination: { total: count ?? 0, limit: query.limit, offset: query.offset },
    }
  }
)

export const POST = defineRoute(
  {
    name: 'campaigns.create',
    auth: 'required',
    body: campaignSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['campaigns:write'],
    feature: 'campaigns',
    rateLimit: 'dashboard',
  },
  async ({ body, actor, business, request }) => {
    const admin = getDb()

    // Surface the audience size at creation time so nobody schedules a send to
    // an empty (or accidentally enormous) list.
    const definition = await resolveSegmentDefinition(business.businessId, body.segmentId ?? null)
    const reach = await countSegment(business.businessId, definition)

    const { data, error } = await admin
      .from('campaigns')
      .insert({
        business_id: business.businessId,
        name: body.name,
        description: body.description ?? null,
        type: body.type,
        status: body.status,
        channels: body.channels,
        segment_id: body.segmentId ?? null,
        subject: body.subject ?? null,
        preheader: body.preheader ?? null,
        body_html: body.bodyHtml ?? null,
        body_text: body.bodyText ?? null,
        sms_body: body.smsBody ?? null,
        whatsapp_body: body.whatsappBody ?? null,
        push_title: body.pushTitle ?? null,
        push_body: body.pushBody ?? null,
        wallet_message: body.walletMessage ?? null,
        cta_label: body.ctaLabel ?? null,
        cta_url: body.ctaUrl ?? null,
        attached_reward_id: body.attachedRewardId ?? null,
        scheduled_at: body.scheduledAt ?? null,
        reach_count: reach,
        estimated_cost: estimateCost(body.channels, reach),
        created_by: actor.id,
        generated_by_ai: body.generatedByAi ?? false,
        ai_prompt: body.aiPrompt ?? null,
      })
      .select('id')
      .single()

    if (error) throw unprocessable(error.message)

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'campaign.created',
      resourceType: 'campaign',
      resourceId: data.id,
      summary: `Created campaign "${body.name}" for ${reach} customers`,
      request,
    })

    return { campaign_id: data.id, estimated_reach: reach }
  }
)

/** Rough per-message unit costs, so the merchant sees the bill before sending. */
function estimateCost(channels: string[], reach: number): number {
  const unit: Record<string, number> = {
    email: 0.0004,
    sms: 0.045,
    whatsapp: 0.035,
    push: 0,
    wallet: 0,
  }
  return channels.reduce((total, channel) => total + (unit[channel] ?? 0) * reach, 0)
}
