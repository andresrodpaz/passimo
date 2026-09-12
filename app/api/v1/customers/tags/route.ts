import { defineRoute } from '@/lib/api/handler'
import { businessIdSchema } from '@/lib/api/schemas'
import { listBusinessTags } from '@/lib/customers/tags'

export const runtime = 'nodejs'

/**
 * The business's tag vocabulary.
 *
 * Exists so the customer list can offer a tag filter and the profile editor can
 * offer one-tap re-use. Both need the same small list, and neither should have
 * to page through every customer to derive it.
 *
 * Why it is its own route rather than a field on the customer list: the list is
 * paginated, so the tags present on page one are not the tags the business uses.
 * A filter built from that would quietly offer a different set of options
 * depending on which page the merchant happened to be on.
 */
export const GET = defineRoute(
  {
    name: 'customers.tags.list',
    auth: 'required',
    query: businessIdSchema,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['customers:read'],
    rateLimit: 'dashboard',
  },
  async ({ business }) => ({ tags: await listBusinessTags(business.businessId) })
)
