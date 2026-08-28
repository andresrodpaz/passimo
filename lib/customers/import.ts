import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { enqueue } from '@/lib/jobs/queue'
import { placeholderEmailForPhone } from '@/lib/customers/placeholder-email'

/**
 * CSV customer import.
 *
 * Migrating an existing list off a competitor (or off a paper punch-card
 * spreadsheet) is the single biggest blocker to switching, so this is
 * deliberately forgiving: it accepts messy headers, dedupes on email or phone,
 * updates rather than rejects existing customers, and reports per-row errors
 * instead of failing the whole file.
 */

export const IMPORT_FIELDS = [
  'email',
  'name',
  'first_name',
  'last_name',
  'phone',
  'birthday',
  'anniversary',
  'balance',
  'visits',
  'total_spend',
  'tags',
  'notes',
  'consent_email',
  'consent_sms',
] as const

export type ImportField = (typeof IMPORT_FIELDS)[number]

/** Header aliases seen in real exports from competitors and spreadsheets. */
const HEADER_ALIASES: Record<string, ImportField> = {
  email: 'email',
  'e-mail': 'email',
  'email address': 'email',
  correo: 'email',
  'correo electrónico': 'email',
  name: 'name',
  'full name': 'name',
  nombre: 'name',
  'first name': 'first_name',
  firstname: 'first_name',
  'last name': 'last_name',
  lastname: 'last_name',
  apellido: 'last_name',
  apellidos: 'last_name',
  phone: 'phone',
  mobile: 'phone',
  telephone: 'phone',
  teléfono: 'phone',
  telefono: 'phone',
  birthday: 'birthday',
  birthdate: 'birthday',
  dob: 'birthday',
  cumpleaños: 'birthday',
  anniversary: 'anniversary',
  points: 'balance',
  stamps: 'balance',
  balance: 'balance',
  puntos: 'balance',
  sellos: 'balance',
  visits: 'visits',
  visitas: 'visits',
  'total spend': 'total_spend',
  spend: 'total_spend',
  gasto: 'total_spend',
  tags: 'tags',
  etiquetas: 'tags',
  notes: 'notes',
  notas: 'notes',
}

/** Best-effort automatic column mapping so most files need zero configuration. */
export function guessMapping(headers: string[]): Record<string, ImportField> {
  const mapping: Record<string, ImportField> = {}
  for (const header of headers) {
    const normalized = header.trim().toLowerCase().replace(/[_-]+/g, ' ')
    const field = HEADER_ALIASES[normalized]
    if (field) mapping[header] = field
  }
  return mapping
}

export type ImportSummary = {
  imported: number
  updated: number
  skipped: number
  errors: Array<{ row: number; reason: string }>
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function importCustomerRows(input: {
  businessId: string
  importId: string
  rows: Record<string, string>[]
  mapping: Record<string, ImportField | string>
}): Promise<ImportSummary> {
  const admin = getDb()
  const summary: ImportSummary = { imported: 0, updated: 0, skipped: 0, errors: [] }

  await admin
    .from('customer_imports')
    .update({ status: 'processing', total_rows: input.rows.length })
    .eq('id', input.importId)

  const { data: program } = await admin
    .from('loyalty_programs')
    .select('id')
    .eq('business_id', input.businessId)
    .eq('is_default', true)
    .maybeSingle()

  for (const [index, raw] of input.rows.entries()) {
    const rowNumber = index + 2 // account for the header line
    try {
      const record = normaliseRow(raw, input.mapping)

      if (!record.email && !record.phone) {
        summary.skipped += 1
        summary.errors.push({ row: rowNumber, reason: 'No email or phone' })
        continue
      }
      if (record.email && !EMAIL_PATTERN.test(record.email)) {
        summary.skipped += 1
        summary.errors.push({ row: rowNumber, reason: `Invalid email: ${record.email}` })
        continue
      }

      const email =
        record.email ?? placeholderEmailForPhone(record.phone!)

      const { data: result, error } = await admin.rpc('passimo_enroll_customer', {
        p_business_id: input.businessId,
        p_email: email,
        p_name: record.name ?? null,
        p_first_name: record.first_name ?? null,
        p_last_name: record.last_name ?? null,
        p_phone: record.phone ?? null,
        p_birthday: record.birthday ?? null,
        p_locale: null,
        p_source: 'import',
        p_location_id: null,
        p_referral_code: null,
        // Imported contacts must not be assumed to have opted in to marketing.
        p_consents: {
          email: record.consent_email ?? false,
          sms: record.consent_sms ?? false,
          whatsapp: false,
          push: true,
          marketing: false,
        },
        p_consent_ip: null,
        p_custom_fields: {},
      })

      if (error) throw error
      const payload = result as { is_new: boolean; customer_id: string }
      if (payload.is_new) summary.imported += 1
      else summary.updated += 1

      // Carry over the balance the merchant already owes their customers —
      // people must not lose progress when a business switches to Passimo.
      if (program && record.balance && record.balance > 0) {
        await admin.rpc('passimo_credit_account', {
          p_business_id: input.businessId,
          p_program_id: program.id,
          p_customer_id: payload.customer_id,
          p_amount: record.balance,
          p_entry_type: 'adjust',
          p_reason: 'Imported balance',
          p_idempotency_key: `import:${input.importId}:${payload.customer_id}`,
        })
      }

      if (record.anniversary) {
        await admin
          .from('customers')
          .update({ anniversary: record.anniversary })
          .eq('id', payload.customer_id)
      }

      if (record.tags?.length) await applyTags(input.businessId, payload.customer_id, record.tags)

      if (record.notes) {
        await admin.from('customer_notes').insert({
          business_id: input.businessId,
          customer_id: payload.customer_id,
          body: record.notes.slice(0, 5000),
          author_name: 'Import',
        })
      }
    } catch (cause) {
      summary.skipped += 1
      summary.errors.push({
        row: rowNumber,
        reason: cause instanceof Error ? cause.message : 'Unknown error',
      })
      if (summary.errors.length > 200) {
        summary.errors.push({ row: rowNumber, reason: 'Too many errors; remaining rows skipped' })
        break
      }
    }
  }

  await admin
    .from('customer_imports')
    .update({
      status: 'completed',
      imported_rows: summary.imported,
      updated_rows: summary.updated,
      skipped_rows: summary.skipped,
      errors: summary.errors.slice(0, 200),
      completed_at: new Date().toISOString(),
    })
    .eq('id', input.importId)

  await enqueue(
    'customers.recompute_stats',
    { businessId: input.businessId },
    { businessId: input.businessId, idempotencyKey: `recompute:${input.importId}` }
  )

  logger.info('customers.import_completed', { importId: input.importId, ...summary })
  return summary
}

export type NormalisedRow = {
  email?: string
  name?: string
  first_name?: string
  last_name?: string
  phone?: string
  birthday?: string
  anniversary?: string
  balance?: number
  tags?: string[]
  notes?: string
  consent_email?: boolean
  consent_sms?: boolean
}

/**
 * Turns one raw CSV row into the shape the enrolment function expects.
 *
 * Exported for tests. This is where a bad import silently corrupts twenty
 * thousand records — a date read as M/D instead of D/M sends birthday campaigns
 * on the wrong day all year, and a mangled phone number is an SMS spend with no
 * recipient. Both are invisible until a merchant notices months later, so the
 * parsing rules are pinned by tests rather than trusted.
 */
export function normaliseRow(
  raw: Record<string, string>,
  mapping: Record<string, ImportField | string>
): NormalisedRow {
  const row: NormalisedRow = {}
  for (const [header, field] of Object.entries(mapping)) {
    const value = raw[header]?.trim()
    if (!value) continue

    switch (field) {
      case 'email':
        row.email = value.toLowerCase()
        break
      case 'name':
        row.name = value
        break
      case 'first_name':
        row.first_name = value
        break
      case 'last_name':
        row.last_name = value
        break
      case 'phone':
        row.phone = normalisePhone(value)
        break
      case 'birthday':
        row.birthday = parseDate(value)
        break
      case 'anniversary':
        row.anniversary = parseDate(value)
        break
      case 'balance': {
        const parsed = Number(value.replace(',', '.'))
        if (Number.isFinite(parsed) && parsed > 0) row.balance = parsed
        break
      }
      case 'tags':
        row.tags = value
          .split(/[;,|]/)
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 10)
        break
      case 'notes':
        row.notes = value
        break
      case 'consent_email':
        row.consent_email = isTruthy(value)
        break
      case 'consent_sms':
        row.consent_sms = isTruthy(value)
        break
      default:
        break
    }
  }

  if (!row.name && (row.first_name || row.last_name)) {
    row.name = [row.first_name, row.last_name].filter(Boolean).join(' ')
  }
  return row
}

function isTruthy(value: string): boolean {
  return ['true', 'yes', 'y', '1', 'si', 'sí'].includes(value.toLowerCase())
}

/** Keeps a leading +, strips formatting. Country-code inference is left to the merchant. */
function normalisePhone(value: string): string | undefined {
  const digits = value.replace(/[^\d+]/g, '')
  if (digits.replace(/\D/g, '').length < 6) return undefined
  return digits
}

/** Accepts ISO, D/M/Y and M/D/Y; ambiguous values resolve to D/M/Y (EU default). */
function parseDate(value: string): string | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const parts = value.split(/[/.\-]/).map((part) => part.trim())
  if (parts.length !== 3) return undefined

  const [first, second] = parts as [string, string, string]
  let year = parts[2]!
  if (year.length === 2) year = `20${year}`
  if (year.length !== 4) return undefined

  let day = Number(first)
  let month = Number(second)
  // Unambiguously US format.
  if (day > 12 && month <= 12) {
    // already D/M
  } else if (month > 12 && day <= 12) {
    ;[day, month] = [month, day]
  }
  if (!Number.isFinite(day) || !Number.isFinite(month)) return undefined
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

async function applyTags(businessId: string, customerId: string, tags: string[]) {
  const admin = getDb()
  for (const name of tags) {
    const { data: tag } = await admin
      .from('tags')
      .upsert({ business_id: businessId, name }, { onConflict: 'business_id,name' })
      .select('id')
      .maybeSingle()
    if (!tag) continue
    await admin
      .from('customer_tags')
      .upsert(
        { customer_id: customerId, tag_id: tag.id, business_id: businessId },
        { onConflict: 'customer_id,tag_id', ignoreDuplicates: true }
      )
  }
}

/**
 * Minimal, dependency-free CSV parser (RFC 4180 quoting).
 * Used server-side where pulling in a parser for one endpoint is not worth it.
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false

  const normalised = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let i = 0; i < normalised.length; i += 1) {
    const char = normalised[i]!
    if (inQuotes) {
      if (char === '"') {
        if (normalised[i + 1] === '"') {
          field += '"'
          i += 1
        } else inQuotes = false
      } else field += char
      continue
    }
    if (char === '"') inQuotes = true
    else if (char === ',' || char === ';') {
      record.push(field)
      field = ''
    } else if (char === '\n') {
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else field += char
  }
  if (field || record.length) {
    record.push(field)
    records.push(record)
  }

  const [headerRow, ...dataRows] = records.filter((row) => row.some((cell) => cell.trim() !== ''))
  if (!headerRow) return { headers: [], rows: [] }

  const headers = headerRow.map((header) => header.trim())
  const rows = dataRows.map((row) => {
    const entry: Record<string, string> = {}
    headers.forEach((header, index) => {
      entry[header] = (row[index] ?? '').trim()
    })
    return entry
  })

  return { headers, rows }
}
