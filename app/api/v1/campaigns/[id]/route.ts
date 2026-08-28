import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { campaignSchema } from '@/lib/api/schemas'
import { getDb } from '@/lib/db'
import { notFound, unprocessable } from '@/lib/errors'
import { recordAudit } from '@/lib/audit'
import { num } from '@/lib/domain/types'

export const runtime = 'nodejs'

const paramsSchema = z.object({ id: z.string().uuid() })
const businessQuery = z.object({ businessId: z.string().uuid() })

export const GET = defineRoute(
  {
    name: 'campaigns.get',
    auth: 'required',
    params: paramsSchema,
    query: businessQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['campaigns:read'],
    rateLimit: 'dashboard',
  },
  async ({ params, business }) => {
    const admin = getDb()
    const { data: campaign } = await admin
      .from('campaigns')
      .select('*')
      .eq('id', params.id)
      .eq('business_id', business.businessId)
      .maybeSingle()

    if (!campaign) throw notFound('Campaign')

    // Delivery breakdown by channel and status — the view that answers
    // "why did only 540 of 800 get it?".
    const { data: messages } = await admin
      .from('messages')
      .select('channel, status, skip_reason')
      .eq('campaign_id', params.id)
      .limit(20000)

    const breakdown: Record<string, Record<string, number>> = {}
    const skipReasons: Record<string, number> = {}
    for (const message of messages ?? []) {
      const channel = message.channel as string
      const status = message.status as string
      breakdown[channel] ??= {}
      breakdown[channel][status] = (breakdown[channel][status] ?? 0) + 1
      if (status === 'skipped' && message.skip_reason) {
        const reason = String(message.skip_reason).split(',')[0]!.trim()
        skipReasons[reason] = (skipReasons[reason] ?? 0) + 1
      }
    }

    return {
      campaign: {
        ...campaign,
        attributed_revenue: num(campaign.attributed_revenue),
        estimated_cost: num(campaign.estimated_cost),
      },
      delivery: breakdown,
      skip_reasons: skipReasons,
    }
  }
)

export const PATCH = defineRoute(
  {
    name: 'campaigns.update',
    auth: 'required',
    params: paramsSchema,
    body: campaignSchema.partial().extend({ businessId: z.string().uuid() }),
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['campaigns:write'],
    rateLimit: 'dashboard',
  },
  async ({ params, body, business }) => {
    const admin = getDb()

    const { data: existing } = await admin
      .from('campaigns')
      .select('status')
      .eq('id', params.id)
      .eq('business_id', business.businessId)
      .maybeSingle()
    if (!existing) throw notFound('Campaign')

    // Editing content mid-send would produce two different messages under one
    // campaign, making the report meaningless.
    if (['sending', 'completed'].includes(existing.status as string)) {
      throw unprocessable('A campaign that has started sending can no longer be edited')
    }

    const patch: Record<string, unknown> = {}
    const map: Record<string, string> = {
      name: 'name',
      description: 'description',
      type: 'type',
      channels: 'channels',
      segmentId: 'segment_id',
      subject: 'subject',
      preheader: 'preheader',
      bodyHtml: 'body_html',
      bodyText: 'body_text',
      smsBody: 'sms_body',
      whatsappBody: 'whatsapp_body',
      pushTitle: 'push_title',
      pushBody: 'push_body',
      walletMessage: 'wallet_message',
      ctaLabel: 'cta_label',
      ctaUrl: 'cta_url',
      attachedRewardId: 'attached_reward_id',
      scheduledAt: 'scheduled_at',
      status: 'status',
    }
    for (const [key, column] of Object.entries(map)) {
      const value = (body as Record<string, unknown>)[key]
      if (value !== undefined) patch[column] = value
    }

    if (Object.keys(patch).length === 0) throw unprocessable('Nothing to update')

    const { error } = await admin
      .from('campaigns')
      .update(patch)
      .eq('id', params.id)
      .eq('business_id', business.businessId)
    if (error) throw unprocessable(error.message)

    return { ok: true }
  }
)

export const DELETE = defineRoute(
  {
    name: 'campaigns.delete',
    auth: 'required',
    params: paramsSchema,
    query: businessQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['campaigns:write'],
    rateLimit: 'dashboard',
  },
  async ({ params, actor, business, request }) => {
    const admin = getDb()
    const { data: existing } = await admin
      .from('campaigns')
      .select('status, name')
      .eq('id', params.id)
      .eq('business_id', business.businessId)
      .maybeSingle()
    if (!existing) throw notFound('Campaign')

    // Sent campaigns are historical record; cancel rather than erase so the
    // revenue attributed to them does not disappear from reporting.
    if (['sending', 'completed'].includes(existing.status as string)) {
      await admin.from('campaigns').update({ status: 'cancelled' }).eq('id', params.id)
      return { ok: true, cancelled: true }
    }

    await admin.from('campaigns').delete().eq('id', params.id)
    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'campaign.deleted',
      resourceType: 'campaign',
      resourceId: params.id,
      summary: `Deleted draft "${existing.name}"`,
      request,
    })
    return { ok: true, deleted: true }
  }
)
