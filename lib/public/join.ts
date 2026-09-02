import 'server-only'
import { getDb } from '@/lib/db'
import { num } from '@/lib/domain/types'

/**
 * The public read behind the enrolment page.
 *
 * Extracted from `app/api/v1/public/business/[slug]/route.ts` so the page and the
 * endpoint cannot disagree. The page needs it because it renders on the server:
 * `/join/{slug}` is the single conversion point of the product — a customer with
 * a phone in one hand and a coffee in the other — and it used to be a client
 * component that shipped a spinner, fetched this same data, and only then knew
 * whether the business existed. Three consequences, all of them paid for at the
 * counter:
 *
 *   1. A slug that does not exist answered **HTTP 200** with a Passimo-branded
 *      shell, then swapped in "not found" after a round trip. Crawlers, link
 *      previews and uptime checks all read that as a live page.
 *   2. The merchant's colours and logo arrived on the second paint, so the first
 *      thing a customer saw of a café's loyalty program was a grey spinner.
 *   3. Every share of the link — WhatsApp, Instagram bio, a printed QR's landing
 *      preview — carried the generic Passimo title instead of the business's own.
 *
 * Returning the same shape the API returns keeps the client component unchanged
 * apart from accepting an initial value.
 */

export type JoinPageData = {
  business: {
    id: string
    name: string
    slug: string
    category: string | null
    city: string | null
    logo_url: string | null
    cover_url: string | null
    primary_color: string | null
    accent_color: string | null
    text_color: string | null
    font: string | null
    locale: string
    website: string | null
  }
  program: {
    id: string
    name: string
    type: string
    unit_singular: string | null
    unit_plural: string | null
    goal_amount: number | null
    reward_description: string | null
  } | null
  rewards: Array<{
    id: string
    name: string
    description: string | null
    cost: number
    image_url: string | null
  }>
  locations: Array<{ id: string; name: string; address: string | null; city: string | null }>
}

/**
 * The subset a stranger may see: everything except the tenant primary key.
 *
 * Both callers need exactly this, so the projection lives beside the read rather
 * than being re-derived at each edge. `business.id` is the one field on the record
 * that a prospective member has no use for, and the one whose leak would let
 * somebody address the tenant directly.
 */
export type PublicJoinData = Omit<JoinPageData, 'business'> & {
  business: Omit<JoinPageData['business'], 'id'>
}

export function toPublicJoinData(data: JoinPageData): PublicJoinData {
  const business = { ...data.business }
  delete (business as { id?: string }).id
  return { ...data, business }
}

/**
 * Returns null for an unknown or archived slug.
 *
 * Null rather than a throw because the two callers need opposite things from the
 * same fact: the route turns it into a 404 envelope, the page calls `notFound()`
 * so Next renders the 404 boundary with a real 404 status.
 */
export async function getJoinPageData(slug: string): Promise<JoinPageData | null> {
  const admin = getDb()

  const { data: business } = await admin
    .from('businesses')
    .select(
      'id, name, slug, category, city, logo_url, cover_url, primary_color, accent_color, text_color, font, locale, website'
    )
    .eq('slug', slug)
    .is('archived_at', null)
    .maybeSingle()

  if (!business) return null

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
      /*
       * Auto-granted rewards are excluded: a birthday reward is something that
       * happens *to* a member, not something on the menu, and listing it here
       * reads as a promise the join form cannot keep.
       */
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
      id: business.id as string,
      name: business.name as string,
      slug: business.slug as string,
      category: (business.category as string) ?? null,
      city: (business.city as string) ?? null,
      logo_url: (business.logo_url as string) ?? null,
      cover_url: (business.cover_url as string) ?? null,
      primary_color: (business.primary_color as string) ?? null,
      accent_color: (business.accent_color as string) ?? null,
      text_color: (business.text_color as string) ?? null,
      font: (business.font as string) ?? null,
      locale: (business.locale as string) ?? 'es',
      website: (business.website as string) ?? null,
    },
    program: program
      ? {
          id: program.id as string,
          name: program.name as string,
          type: program.type as string,
          unit_singular: (program.unit_singular as string) ?? null,
          unit_plural: (program.unit_plural as string) ?? null,
          goal_amount: num(program.goal_amount) || null,
          reward_description: (program.reward_description as string) ?? null,
        }
      : null,
    rewards: (rewards ?? []).map((reward) => ({
      id: reward.id as string,
      name: reward.name as string,
      description: (reward.description as string) ?? null,
      cost: num(reward.cost),
      image_url: (reward.image_url as string) ?? null,
    })),
    locations: (locations ?? []) as JoinPageData['locations'],
  }
}
