import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { verifyToken } from '@/lib/crypto'
import { getDb } from '@/lib/db'
import { badRequest } from '@/lib/errors'
import { enqueue } from '@/lib/jobs/queue'

export const runtime = 'nodejs'

const bodySchema = z.object({
  token: z.string().min(10).max(600),
  score: z.number().int().min(0).max(10),
  comment: z.string().max(2000).optional(),
})

/**
 * Records an NPS/CSAT response.
 *
 * Scores are stored on a proper 0–10 NPS scale (the original schema used 1–5
 * and called it NPS, which made every reported figure wrong). A detractor
 * triggers private service recovery; a promoter can be asked for a public
 * review — the two highest-value follow-ups a local business has.
 */
export const POST = defineRoute(
  { name: 'public.survey', auth: 'none', body: bodySchema, rateLimit: 'publicStrict' },
  async ({ body }) => {
    const payload = verifyToken<{ c: string; b: string; s?: string }>('survey', body.token)
    if (!payload) throw badRequest('This survey link is invalid or has expired')

    const admin = getDb()
    const { data: survey } = await admin
      .from('surveys')
      .select('id, scale_max, cooldown_days')
      .eq('business_id', payload.b)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    const scaleMax = Number(survey?.scale_max ?? 10)
    if (body.score > scaleMax) throw badRequest(`Score must be between 0 and ${scaleMax}`)

    // One response per customer per cooldown window: without this, a shared
    // link could be used to stuff the score.
    const cooldownDays = Number(survey?.cooldown_days ?? 90)
    const { data: recent } = await admin
      .from('survey_responses')
      .select('id')
      .eq('customer_id', payload.c)
      .gte(
        'responded_at',
        new Date(Date.now() - cooldownDays * 86_400_000).toISOString()
      )
      .maybeSingle()

    if (recent) {
      await admin
        .from('survey_responses')
        .update({ score: body.score, comment: body.comment ?? null, responded_at: new Date().toISOString() })
        .eq('id', recent.id)
      return { recorded: true, updated: true }
    }

    await admin.from('survey_responses').insert({
      business_id: payload.b,
      survey_id: survey?.id ?? null,
      customer_id: payload.c,
      score: body.score,
      scale_max: scaleMax,
      comment: body.comment ?? null,
    })

    await admin.from('activity_events').insert({
      business_id: payload.b,
      customer_id: payload.c,
      type: 'survey',
      source: 'web',
      metadata: { score: body.score, scale_max: scaleMax },
    })

    const promoterFloor = scaleMax === 5 ? 5 : 9
    const detractorCeiling = scaleMax === 5 ? 3 : 6

    if (body.score >= promoterFloor) {
      await enqueue(
        'automation.enroll',
        { businessId: payload.b, customerId: payload.c, trigger: 'nps_promoter' },
        { businessId: payload.b }
      )
    } else if (body.score <= detractorCeiling) {
      await enqueue(
        'automation.enroll',
        { businessId: payload.b, customerId: payload.c, trigger: 'nps_detractor' },
        { businessId: payload.b, priority: 10 }
      )
    }

    await enqueue(
      'webhook.deliver',
      {
        businessId: payload.b,
        event: 'survey.responded',
        data: { customer_id: payload.c, score: body.score, scale_max: scaleMax },
      },
      { businessId: payload.b }
    )

    return {
      recorded: true,
      // Promoters get pointed at a public review; everyone else gets a private
      // apology path. Never send an unhappy customer to Google.
      is_promoter: body.score >= promoterFloor,
    }
  }
)
