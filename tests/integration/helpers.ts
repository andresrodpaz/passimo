import { getDb, query, closePool } from '@/lib/db'
import { createUser } from '@/lib/auth/users'
import { randomUUID } from 'node:crypto'

/**
 * Fixtures for the integration suite.
 *
 * Every test creates its own tenant with a unique slug and tears it down
 * afterwards. Nothing here reads or writes the demo data: a test that depends on
 * `pnpm seed:demo` having run is a test that fails on a colleague's machine for
 * no reason, and one that mutates it makes the next `pnpm dev` confusing.
 */

export type TestTenant = {
  userId: string
  businessId: string
  slug: string
  email: string
  programId: string
}

/** Confirms the database is reachable and migrated, with an actionable message. */
export async function assertDatabaseReady(): Promise<void> {
  try {
    const { rows } = await query<{ count: number }>(
      "select count(*)::int as count from information_schema.tables where table_schema = 'public' and table_name = 'businesses'"
    )
    if ((rows[0]?.count ?? 0) === 0) {
      throw new Error('schema not applied')
    }
  } catch (error) {
    throw new Error(
      'Integration tests need a migrated PostgreSQL database.\n' +
        '  pnpm db:up && pnpm db:migrate\n' +
        `Underlying error: ${(error as Error).message}`
    )
  }
}

let counter = 0

export async function createTenant(
  label = 'test'
): Promise<TestTenant> {
  counter += 1
  const unique = `${Date.now().toString(36)}${counter}`
  const email = `${label}-${unique}@passimo.test`
  const slug = `${label}-${unique}`

  const user = await createUser({
    email,
    password: 'integration-test-password',
    fullName: `${label} owner`,
    emailVerified: true,
  })

  const db = getDb()
  const { data: business, error } = await db
    .from('businesses')
    .insert({
      owner_id: user.id,
      name: `${label} ${unique}`,
      slug,
      currency: 'EUR',
      locale: 'en',
      timezone: 'Europe/Madrid',
      plan: 'growth',
      subscription_status: 'active',
    })
    .select('id')
    .single()

  if (error || !business) throw new Error(`fixture business failed: ${error?.message}`)

  await db.from('team_members').upsert(
    {
      business_id: business.id,
      user_id: user.id,
      role: 'owner',
      status: 'active',
      accepted_at: new Date().toISOString(),
    },
    { onConflict: 'business_id,user_id' }
  )

  // Provisioned by the same function a real signup calls, so the fixture is a
  // correctly set up business rather than an approximation of one.
  const { error: provisionError } = await db.rpc('passimo_provision_business', {
    p_business_id: business.id,
  })
  if (provisionError) throw new Error(`fixture provisioning failed: ${provisionError.message}`)

  const { data: program } = await db
    .from('loyalty_programs')
    .select('id')
    .eq('business_id', business.id)
    .eq('is_default', true)
    .maybeSingle()

  return {
    userId: user.id,
    businessId: business.id as string,
    slug,
    email,
    programId: (program?.id as string) ?? '',
  }
}

/**
 * Removes a tenant.
 *
 * Deleting the business cascades to everything scoped to it; deleting the user
 * cascades to sessions and tokens. Both are `on delete cascade` in the schema,
 * which is itself worth exercising — a missing cascade shows up here as a
 * foreign-key error rather than as an orphaned row nobody notices for a year.
 */
export async function dropTenant(tenant: TestTenant): Promise<void> {
  const db = getDb()
  await db.from('businesses').delete().eq('id', tenant.businessId)
  await db.from('app_users').delete().eq('id', tenant.userId)
}

/** Enrols a customer through the same function the product uses. */
export async function createCustomer(
  businessId: string,
  overrides: { email?: string; name?: string; phone?: string } = {}
): Promise<string> {
  const { data, error } = await getDb().rpc('passimo_enroll_customer', {
    p_business_id: businessId,
    p_email: overrides.email ?? `customer-${randomUUID().slice(0, 8)}@passimo.test`,
    p_phone: overrides.phone ?? null,
    p_name: overrides.name ?? 'Test Customer',
    p_source: 'qr',
  })
  if (error) throw new Error(`enroll failed: ${error.message}`)

  const id = (data as { customer_id?: string } | null)?.customer_id
  if (!id) throw new Error(`enroll returned no customer id: ${JSON.stringify(data)}`)
  return id
}

export async function shutdown(): Promise<void> {
  await closePool()
}
