import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { env } from '@/lib/env'
import { payloadTooLarge, unprocessable } from '@/lib/errors'
import { enqueue } from '@/lib/jobs/queue'
import { guessMapping, parseCsv, IMPORT_FIELDS } from '@/lib/customers/import'
import { recordAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const maxDuration = 60

const bodySchema = z.object({
  businessId: z.string().uuid(),
  csv: z.string().min(1).max(10_000_000),
  filename: z.string().max(200).optional(),
  /** Omit to preview the detected mapping without importing. */
  mapping: z.record(z.string()).optional(),
  dryRun: z.boolean().default(false),
})

/**
 * CSV import.
 *
 * Two-phase by design: the first call returns the detected column mapping and a
 * preview so the merchant can confirm before 4,000 rows are written. The second
 * call enqueues the work in chunks — an import must never be bounded by an HTTP
 * timeout.
 */
export const POST = defineRoute(
  {
    name: 'customers.import',
    auth: 'required',
    body: bodySchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['customers:import'],
    rateLimit: 'bulk',
    maxBodyBytes: 12_000_000,
  },
  async ({ body, actor, business, request }) => {
    const { headers, rows } = parseCsv(body.csv)
    if (headers.length === 0) throw unprocessable('That file has no header row')
    if (rows.length === 0) throw unprocessable('That file has no data rows')
    if (rows.length > env.limits.maxImportRows) {
      throw payloadTooLarge(
        `That file has ${rows.length} rows; the limit is ${env.limits.maxImportRows}. Split it and import in parts.`
      )
    }

    const mapping = body.mapping ?? guessMapping(headers)
    const mappedFields = new Set(Object.values(mapping))

    if (!mappedFields.has('email') && !mappedFields.has('phone')) {
      return {
        preview: true,
        headers,
        detected_mapping: mapping,
        available_fields: IMPORT_FIELDS,
        total_rows: rows.length,
        sample: rows.slice(0, 5),
        error: 'Map at least an email or phone column before importing',
      }
    }

    if (body.dryRun || !body.mapping) {
      return {
        preview: true,
        headers,
        detected_mapping: mapping,
        available_fields: IMPORT_FIELDS,
        total_rows: rows.length,
        sample: rows.slice(0, 5),
      }
    }

    const admin = getDb()
    const { data: importRow, error } = await admin
      .from('customer_imports')
      .insert({
        business_id: business.businessId,
        filename: body.filename ?? 'import.csv',
        total_rows: rows.length,
        mapping,
        created_by: actor.id,
      })
      .select('id')
      .single()

    if (error) throw unprocessable(error.message)

    // Chunked so one bad row cannot fail an entire 20,000-row import and a
    // retry only replays the affected chunk.
    const CHUNK = 500
    for (let offset = 0; offset < rows.length; offset += CHUNK) {
      await enqueue(
        'customers.import',
        {
          businessId: business.businessId,
          importId: importRow.id,
          rows: rows.slice(offset, offset + CHUNK),
          mapping,
        },
        {
          businessId: business.businessId,
          priority: 120,
          idempotencyKey: `import:${importRow.id}:${offset}`,
        }
      )
    }

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'customers.import_started',
      resourceType: 'import',
      resourceId: importRow.id,
      summary: `Importing ${rows.length} rows from ${body.filename ?? 'CSV'}`,
      request,
    })

    return { import_id: importRow.id, total_rows: rows.length, queued: true }
  }
)

const statusQuery = z.object({
  businessId: z.string().uuid(),
  importId: z.string().uuid().optional(),
})

export const GET = defineRoute(
  {
    name: 'customers.import_status',
    auth: 'required',
    query: statusQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['customers:read'],
    rateLimit: 'dashboard',
  },
  async ({ query, business }) => {
    const admin = getDb()
    let request = admin
      .from('customer_imports')
      .select('*')
      .eq('business_id', business.businessId)
      .order('created_at', { ascending: false })
      .limit(10)

    if (query.importId) request = request.eq('id', query.importId)

    const { data } = await request
    return { imports: data ?? [] }
  }
)
