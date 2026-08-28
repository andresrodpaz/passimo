import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { listCustomers } from '@/lib/customers/service'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const maxDuration = 60

const querySchema = z.object({
  businessId: z.string().uuid(),
  segmentId: z.string().uuid().optional(),
  format: z.enum(['csv', 'json']).default('csv'),
})

/**
 * Customer export.
 *
 * Merchants own their data and must be able to take it with them — a platform
 * that holds a list hostage gets churned out of at the first opportunity, and
 * refusing export would breach GDPR data portability anyway. Every export is
 * audited so the owner can see who took a copy.
 */
export const GET = defineRoute(
  {
    name: 'customers.export',
    auth: 'required',
    query: querySchema,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['customers:export'],
    rateLimit: 'bulk',
  },
  async ({ query, actor, business, request }) => {
    const pageSize = 1000
    const all: Awaited<ReturnType<typeof listCustomers>>['customers'] = []

    for (let offset = 0; offset < 50_000; offset += pageSize) {
      const page = await listCustomers({
        businessId: business.businessId,
        segmentId: query.segmentId,
        limit: pageSize,
        offset,
        sort: 'recent',
      })
      all.push(...page.customers)
      if (page.customers.length < pageSize) break
    }

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'customers.exported',
      summary: `Exported ${all.length} customers`,
      metadata: { segment_id: query.segmentId ?? null, format: query.format },
      request,
    })

    if (query.format === 'json') {
      return new Response(JSON.stringify({ customers: all }, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="customers-${today()}.json"`,
        },
      })
    }

    const columns = [
      'email',
      'first_name',
      'last_name',
      'phone',
      'birthday',
      'balance',
      'visits',
      'lifetime_spend',
      'average_ticket',
      'last_visit',
      'joined',
      'vip',
      'segment',
      'churn_risk',
      'tags',
      'consent_email',
      'consent_sms',
    ]

    const lines = [columns.join(',')]
    for (const customer of all) {
      lines.push(
        [
          customer.email,
          customer.firstName ?? '',
          customer.lastName ?? '',
          customer.phone ?? '',
          customer.birthday ?? '',
          customer.primaryBalance,
          customer.visitCount,
          customer.lifetimeSpend,
          customer.averageTicket,
          customer.lastVisit ?? '',
          customer.createdAt,
          customer.isVip ? 'yes' : 'no',
          customer.rfmSegment ?? '',
          customer.churnRisk ?? '',
          customer.tags.map((tag) => tag.name).join('; '),
          customer.consents.email ? 'yes' : 'no',
          customer.consents.sms ? 'yes' : 'no',
        ]
          .map(csvCell)
          .join(',')
      )
    }

    return new Response(`﻿${lines.join('\n')}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="customers-${today()}.csv"`,
      },
    })
  }
)

/** RFC 4180 quoting, plus a guard against spreadsheet formula injection. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
