import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { lookupCustomers } from '@/lib/customers/service'
import { classifyScan, searchTermFor } from '@/lib/scan/payload'
import { summarize } from '@/lib/scan/resolve'
import { verifyToken } from '@/lib/crypto'

export const runtime = 'nodejs'

const querySchema = z.object({
  businessId: z.string().uuid(),
  q: z.string().trim().min(1).max(200),
})

/**
 * Counter search: name, phone, email or a scanned identifier.
 *
 * Returns the same `CustomerSummary` shape as `/counter/roster` and the scan
 * resolver's `candidates`, so the scanner renders a search result, a recent
 * visitor and an ambiguous scan match with one component and no field mapping.
 *
 * For a single definite answer — and to credit a visit in the same request —
 * use `POST /scan` instead. This endpoint is the type-ahead behind it.
 */
export const GET = defineRoute(
  {
    name: 'customers.lookup',
    auth: 'required',
    query: querySchema,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['customers:read'],
    rateLimit: 'pos',
  },
  async ({ query, business }) => {
    // Classified the same way a scan is, so pasting a card URL or a signed token
    // into the search box resolves rather than being searched for as a name.
    const payload = classifyScan(query.q)

    let term: string
    switch (payload.kind) {
      case 'customer_id':
        term = payload.customerId
        break
      case 'card_token': {
        const verified = verifyToken<{ c: string }>('card', payload.token)
        // An expired token yields no results rather than a name search for it.
        if (!verified?.c) return { customers: [] }
        term = verified.c
        break
      }
      default:
        term = searchTermFor(payload) ?? query.q
    }

    const customers = await lookupCustomers(business.businessId, term)
    return { customers: customers.map(summarize) }
  }
)
