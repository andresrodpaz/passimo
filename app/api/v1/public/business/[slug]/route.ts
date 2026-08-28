import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { notFound } from '@/lib/errors'
import { num } from '@/lib/domain/types'

export const runtime = 'nodejs'

const paramsSchema = z.object({ slug: z.string().min(1).max(80) })

/**
 * Public brand + program metadata for the join page.
 *
 * Returns only what a prospective member needs to see. Deliberately excludes
 * anything that would let a competitor profile the business (customer counts,
 * revenue, campaign history).
 */
export const GET = defineRoute(
  {
    name: 'public.business',
    auth: 'none',
    params: paramsSchema,
    rateLimit: 'publicRelaxed',
  },
  async ({ params }) => {
    const admin = getDb()

    const { data: business } = await admin
      .from('businesses')
      .select(
        'id, name, slug, category, city, logo_url, cover_url, primary_color, accent_color, text_color, font, locale, website'
      )
      .eq('slug', params.slug)
      .is('archived_at', null)
      .maybeSingle()

    if (!business) throw notFound('Business')

    const [{ data: program }, { data: rewards }, { data: locations }] = await Promise.all([
      admin
        .from('loyalty_programs')
        .select('id, name, type, unit_singular, unit_plural, goal_amount, reward_description')
        .eq('business_id', business.id)
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle(),
      admin
        .from('rewards')
        .select('id, name, description, cost, image_url')
        .eq('business_id', business.id)
        .eq('is_active', true)
        .is('auto_grant_trigger', null)
        .order('sort_order')
        .limit(6),
      admin
        .from('locations')
        .select('id, name, address, city')
        .eq('business_id', business.id)
        .is('archived_at', null)
        .limit(20),
    ])

    return {
      business: {
        name: business.name,
        slug: business.slug,
        category: business.category,
        city: business.city,
        logo_url: business.logo_url,
        cover_url: business.cover_url,
        primary_color: business.primary_color,
        accent_color: business.accent_color,
        text_color: business.text_color,
        font: business.font,
        locale: business.locale,
        website: business.website,
      },
      program: program
        ? {
            id: program.id,
            name: program.name,
            type: program.type,
            unit_singular: program.unit_singular,
            unit_plural: program.unit_plural,
            goal_amount: num(program.goal_amount) || null,
            reward_description: program.reward_description,
          }
        : null,
      rewards: (rewards ?? []).map((reward) => ({
        id: reward.id,
        name: reward.name,
        description: reward.description,
        cost: num(reward.cost),
        image_url: reward.image_url,
      })),
      locations: locations ?? [],
    }
  }
)
