import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { notFound, unprocessable } from '@/lib/errors'
import { enqueue } from '@/lib/jobs/queue'
import { recordAudit } from '@/lib/audit'
import { dispatchMessage } from '@/lib/messaging/dispatch'
import { countSegment, resolveSegmentDefinition } from '@/lib/segments/resolve'
import { configuredChannels } from '@/lib/messaging/providers'

export const runtime = 'nodejs'

const paramsSchema = z.object({ id: z.string().uuid() })
const bodySchema = z.object({
  businessId: z.string().uuid(),
  /** Send only to this customer, to preview the real thing before committing. */
  testCustomerId: z.string().uuid().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
})

/**
 * Starts a campaign.
 *
 * The request enqueues work and returns immediately; the worker fans out in
 * batches. This is what makes a 20,000-person send possible at all — the
 * previous implementation looped over every customer inside the HTTP request.
 */
export const POST = defineRoute(
  {
    name: 'campaigns.send',
    auth: 'required',
    params: paramsSchema,
    body: bodySchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['campaigns:send'],
    feature: 'campaigns',
    rateLimit: 'outbound',
  },
  async ({ params, body, actor, business, request }) => {
    const admin = getDb()
    const { data: campaign } = await admin
      .from('campaigns')
      .select('*')
      .eq('id', params.id)
      .eq('business_id', business.businessId)
      .maybeSingle()

    if (!campaign) throw notFound('Campaign')

    const channels = (campaign.channels as string[]) ?? []
    const available = configuredChannels()
    const unavailable = channels.filter((channel) => !available.includes(channel))
    if (unavailable.length === channels.length) {
      throw unprocessable(
        `None of the selected channels are configured on this deployment: ${unavailable.join(', ')}`
      )
    }

    // Test send: real pipeline, real rendering, one recipient.
    if (body.testCustomerId) {
      const outcome = await dispatchMessage({
        businessId: business.businessId,
        customerId: body.testCustomerId,
        channel: (channels[0] as never) ?? 'email',
        subject: campaign.subject as string | null,
        body:
          (campaign.body_text as string) ??
          (campaign.sms_body as string) ??
          (campaign.push_body as string) ??
          '',
        html: campaign.body_html as string | null,
        url: campaign.cta_url as string | null,
        // Not attributed to the campaign, and exempt from consent checks so a
        // merchant can always preview to themselves.
        category: 'transactional',
      })
      return { test: true, ...outcome }
    }

    if (['sending', 'completed'].includes(campaign.status as string)) {
      throw unprocessable(`This campaign is already ${campaign.status}`)
    }

    const definition = await resolveSegmentDefinition(
      business.businessId,
      campaign.segment_id as string | null
    )
    const reach = await countSegment(business.businessId, definition)
    if (reach === 0) throw unprocessable('This audience is empty — nobody would receive it')

    const runAfter = body.scheduledAt ? new Date(body.scheduledAt) : new Date()

    await admin
      .from('campaigns')
      .update({
        status: body.scheduledAt ? 'scheduled' : 'sending',
        scheduled_at: body.scheduledAt ?? null,
        reach_count: reach,
      })
      .eq('id', params.id)

    await enqueue(
      'campaign.dispatch',
      { campaignId: params.id },
      {
        businessId: business.businessId,
        runAfter,
        priority: 40,
        idempotencyKey: `campaign:${params.id}:dispatch`,
      }
    )

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'campaign.sent',
      resourceType: 'campaign',
      resourceId: params.id,
      summary: `${body.scheduledAt ? 'Scheduled' : 'Started'} "${campaign.name}" to ${reach} customers`,
      metadata: { channels, reach },
      request,
    })

    return {
      queued: true,
      scheduled_at: body.scheduledAt ?? null,
      reach,
      channels_used: channels.filter((channel) => available.includes(channel)),
      channels_unavailable: unavailable,
    }
  }
)
