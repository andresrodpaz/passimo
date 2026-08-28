/**
 * Demo environment seed.
 *
 *   pnpm seed:demo
 *
 * Creates four merchant accounts — one per plan — a platform admin, and enough
 * realistic data that every screen in the product has something on it: customers with
 * histories, transactions, visits, rewards, campaigns, wallet passes, geofence events,
 * notifications and analytics.
 *
 * Why this exists as a script rather than a SQL seed: it goes through the same database
 * layer and the same account-creation code the application uses, so the seed exercises
 * the real provisioning path. If `passimo_provision_business` breaks, or password
 * hashing changes shape, seeding breaks — which is a much better place to find out than
 * a merchant's first signup. A demo environment you cannot log in to is not a demo
 * environment.
 *
 * Three properties it holds deliberately:
 *
 *   1. **Refuses to run against production.** Guarded on `NEXT_PUBLIC_APP_URL`. A seed
 *      script that can write demo customers into a real tenant is a data-integrity
 *      incident waiting for a mistyped environment.
 *   2. **Idempotent.** Re-running it updates the same businesses rather than creating
 *      a fifth Madrid Coffee. Local development means running it repeatedly.
 *   3. **Deterministic.** A seeded PRNG, not `Math.random()`, so two developers see
 *      the same numbers and a screenshot in a bug report matches what the next person
 *      sees.
 */

import { randomUUID } from 'node:crypto'
import { getDb, query, type Database } from '@/lib/db'
import { createUser, findUserByEmail, setPassword } from '@/lib/auth/users'

// -----------------------------------------------------------------------------
// Guards and setup
// -----------------------------------------------------------------------------

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'PassimoDemo2026!'
const ADMIN_EMAILS = (process.env.PLATFORM_ADMIN_EMAILS ?? 'admin@passimo.demo')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean)

const DEVELOPMENT_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal']

function assertSafeToSeed(): void {
  if (!process.env.DATABASE_URL) {
    fail(
      'DATABASE_URL is required. Start the local database with `pnpm db:up`, apply ' +
        'the schema with `pnpm db:migrate`, then run this again. See .env.example.'
    )
  }

  if (DEMO_PASSWORD.length < 10) {
    fail('DEMO_PASSWORD must be at least 10 characters — the same rule real accounts follow.')
  }

  const allowProduction = process.argv.includes('--i-know-what-i-am-doing')
  let host = ''
  try {
    host = new URL(APP_URL).hostname
  } catch {
    fail(`NEXT_PUBLIC_APP_URL is not a valid URL: ${APP_URL}`)
  }

  /*
   * `.vercel.app` used to count as development here. It no longer does: a preview
   * deployment can be pointed at a production database, and "the hostname looks
   * like a preview" is not evidence about which database is behind it.
   */
  const isDevelopment =
    DEVELOPMENT_HOSTS.includes(host) ||
    host.endsWith('.local') ||
    host.endsWith('.localhost') ||
    process.env.NODE_ENV === 'development'

  if (!isDevelopment && !allowProduction) {
    fail(
      `Refusing to seed demo data against ${host}. This creates fake customers and merchants.\n` +
        'If you are certain, re-run with --i-know-what-i-am-doing.'
    )
  }
}

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`)
  process.exit(1)
}

/**
 * A small deterministic PRNG (mulberry32).
 *
 * `Math.random()` would make every run produce different numbers, so two developers
 * comparing a screen would see different data and a bug report would not reproduce.
 */
function makeRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const random = makeRandom(20260730)

const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]
const between = (min: number, max: number): number =>
  Math.floor(random() * (max - min + 1)) + min
const chance = (probability: number): boolean => random() < probability
const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString()

// -----------------------------------------------------------------------------
// Demo definitions
// -----------------------------------------------------------------------------

type DemoBusiness = {
  email: string
  plan: 'starter' | 'growth' | 'pro' | 'business'
  name: string
  slug: string
  category: string
  city: string
  template: string
  primaryColor: string
  textColor: string
  program: {
    name: string
    type: 'stamps' | 'points'
    unitSingular: string
    unitPlural: string
    goal: number
    reward: string
  }
  locations: Array<{
    name: string
    address: string
    city: string
    postalCode: string
    lat: number
    lng: number
    radius: number
    primary?: boolean
  }>
  customerCount: number
  rewards: Array<{ name: string; cost: number; description: string }>
}

/**
 * Four businesses, one per plan, each in a different trade — so a reviewer opening
 * the demo sees the product working for a café, a barber, a gym and a bakery rather
 * than four copies of the same café.
 *
 * Coordinates are real city-centre locations. Proximity cannot be demonstrated with
 * invented coordinates: a geofence 50 m from `0, 0` is in the Atlantic.
 */
const BUSINESSES: DemoBusiness[] = [
  {
    email: 'starter@demo.com',
    plan: 'starter',
    name: 'Madrid Coffee',
    slug: 'madrid-coffee',
    category: 'cafe',
    city: 'Madrid',
    template: 'coffee_shop',
    primaryColor: '#1F1408',
    textColor: '#FFF8F0',
    program: {
      name: 'Coffee Club',
      type: 'stamps',
      unitSingular: 'stamp',
      unitPlural: 'stamps',
      goal: 8,
      reward: 'A free coffee of your choice',
    },
    locations: [
      {
        name: 'Calle Mayor',
        address: 'Calle Mayor 12',
        city: 'Madrid',
        postalCode: '28013',
        lat: 40.4155,
        lng: -3.7074,
        radius: 150,
        primary: true,
      },
    ],
    customerCount: 140,
    rewards: [
      { name: 'Free coffee', cost: 8, description: 'Any drink from the menu, on us.' },
      { name: 'Free pastry', cost: 5, description: 'Croissant or pain au chocolat.' },
    ],
  },
  {
    email: 'growth@demo.com',
    plan: 'growth',
    name: 'Barcelona Barber',
    slug: 'barcelona-barber',
    category: 'barber',
    city: 'Barcelona',
    template: 'barber_shop',
    primaryColor: '#111827',
    textColor: '#F9FAFB',
    program: {
      name: 'Cuts Club',
      type: 'stamps',
      unitSingular: 'cut',
      unitPlural: 'cuts',
      goal: 10,
      reward: 'Your tenth cut free',
    },
    locations: [
      {
        name: 'Gràcia',
        address: 'Carrer Gran de Gràcia 88',
        city: 'Barcelona',
        postalCode: '08012',
        lat: 41.4025,
        lng: 2.1554,
        radius: 250,
        primary: true,
      },
      {
        name: 'El Born',
        address: 'Carrer de Montcada 14',
        city: 'Barcelona',
        postalCode: '08003',
        lat: 41.3853,
        lng: 2.1811,
        radius: 200,
      },
      {
        name: 'Eixample',
        address: 'Carrer d’Aragó 210',
        city: 'Barcelona',
        postalCode: '08011',
        lat: 41.3873,
        lng: 2.1589,
        radius: 300,
      },
    ],
    customerCount: 420,
    rewards: [
      { name: 'Free cut', cost: 10, description: 'A full cut and finish.' },
      { name: 'Beard trim', cost: 4, description: 'Tidy-up between cuts.' },
    ],
  },
  {
    email: 'pro@demo.com',
    plan: 'pro',
    name: 'Valencia Fitness',
    slug: 'valencia-fitness',
    category: 'gym',
    city: 'Valencia',
    template: 'gym',
    primaryColor: '#0F766E',
    textColor: '#ECFEFF',
    program: {
      name: 'Training Points',
      type: 'points',
      unitSingular: 'point',
      unitPlural: 'points',
      goal: 500,
      reward: 'A free personal training session',
    },
    locations: [
      {
        name: 'Ruzafa',
        address: 'Carrer de Cadis 44',
        city: 'Valencia',
        postalCode: '46006',
        lat: 39.4592,
        lng: -0.3712,
        radius: 600,
        primary: true,
      },
      {
        name: 'Benimaclet',
        address: 'Carrer de Bartomeu Bolívar 3',
        city: 'Valencia',
        postalCode: '46020',
        lat: 39.4869,
        lng: -0.3527,
        radius: 600,
      },
      {
        name: 'Port',
        address: 'Carrer de Doctor Marcos Sopena 8',
        city: 'Valencia',
        postalCode: '46010',
        lat: 39.4712,
        lng: -0.3455,
        radius: 800,
      },
    ],
    customerCount: 860,
    rewards: [
      { name: 'PT session', cost: 500, description: 'One hour with a trainer.' },
      { name: 'Guest pass', cost: 200, description: 'Bring a friend for free.' },
      { name: 'Protein shake', cost: 80, description: 'From the bar.' },
    ],
  },
  {
    email: 'business@demo.com',
    plan: 'business',
    name: 'Sevilla Bakery',
    slug: 'sevilla-bakery',
    category: 'bakery',
    city: 'Sevilla',
    template: 'bakery',
    primaryColor: '#C98A3C',
    textColor: '#FFFBF5',
    program: {
      name: 'Bakery Rewards',
      type: 'points',
      unitSingular: 'point',
      unitPlural: 'points',
      goal: 200,
      reward: 'A free loaf of your choice',
    },
    locations: [
      {
        name: 'Triana',
        address: 'Calle San Jacinto 25',
        city: 'Sevilla',
        postalCode: '41010',
        lat: 37.383,
        lng: -6.0028,
        radius: 180,
        primary: true,
      },
      {
        name: 'Centro',
        address: 'Calle Sierpes 40',
        city: 'Sevilla',
        postalCode: '41004',
        lat: 37.3903,
        lng: -5.9954,
        radius: 150,
      },
      {
        name: 'Nervión',
        address: 'Av. de Eduardo Dato 60',
        city: 'Sevilla',
        postalCode: '41005',
        lat: 37.3862,
        lng: -5.9723,
        radius: 200,
      },
      {
        name: 'Los Remedios',
        address: 'Calle Asunción 12',
        city: 'Sevilla',
        postalCode: '41011',
        lat: 37.3773,
        lng: -6.0021,
        radius: 180,
      },
    ],
    customerCount: 1_240,
    rewards: [
      { name: 'Free loaf', cost: 200, description: 'Any bread from the shelf.' },
      { name: 'Coffee and croissant', cost: 90, description: 'The morning special.' },
      { name: 'Birthday cake discount', cost: 400, description: '30% off any celebration cake.' },
    ],
  },
]

const FIRST_NAMES = [
  'Lucía', 'Martín', 'Sofía', 'Hugo', 'María', 'Mateo', 'Paula', 'Daniel', 'Emma', 'Pablo',
  'Carmen', 'Álvaro', 'Sara', 'Diego', 'Julia', 'Adrián', 'Alba', 'Javier', 'Noa', 'Marco',
  'Elena', 'Sergio', 'Irene', 'Rubén', 'Claudia', 'Iván', 'Nerea', 'Gonzalo', 'Ana', 'Jorge',
]

const LAST_NAMES = [
  'García', 'Rodríguez', 'Martínez', 'López', 'Sánchez', 'Pérez', 'Gómez', 'Fernández',
  'Ruiz', 'Díaz', 'Moreno', 'Álvarez', 'Romero', 'Torres', 'Navarro', 'Jiménez', 'Muñoz',
  'Serrano', 'Blanco', 'Castro',
]

// -----------------------------------------------------------------------------
// Seeding
// -----------------------------------------------------------------------------

type Admin = Database

async function main(): Promise<void> {
  assertSafeToSeed()

  const admin = getDb()

  console.log(`\n  Seeding the demo environment against ${APP_URL}\n`)

  for (const definition of BUSINESSES) {
    await seedBusiness(admin, definition)
  }

  await seedPlatformAdmin(admin)

  console.log('\n  ✓ Done. Sign in with any of:\n')
  for (const definition of BUSINESSES) {
    console.log(
      `      ${definition.email.padEnd(20)} ${DEMO_PASSWORD.padEnd(20)} ${definition.plan}`
    )
  }
  for (const email of ADMIN_EMAILS) {
    console.log(`      ${email.padEnd(20)} ${DEMO_PASSWORD.padEnd(20)} platform admin`)
  }
  console.log('')
}

/**
 * Creates the demo account, or brings an existing one back to the documented state.
 *
 * Idempotent by email, because local development means running this repeatedly. The
 * password is reset on every run so a database seeded weeks ago still matches the
 * credentials this script prints — the single most common demo-environment complaint is
 * "the README password does not work".
 */
async function ensureUser(_admin: Admin, email: string, fullName: string): Promise<string> {
  const existing = await findUserByEmail(email)
  if (existing) {
    await setPassword(existing.id, DEMO_PASSWORD)
    return existing.id
  }

  try {
    const created = await createUser({
      email,
      password: DEMO_PASSWORD,
      fullName,
      locale: 'es',
      // Demo accounts skip the inbox round trip; there is no inbox.
      emailVerified: true,
      metadata: { demo: true, seeded_at: new Date().toISOString() },
    })
    return created.id
  } catch (error) {
    fail(`Could not create the demo user ${email}: ${(error as Error).message}`)
  }
}

async function seedBusiness(admin: Admin, definition: DemoBusiness): Promise<void> {
  process.stdout.write(`  · ${definition.name} (${definition.plan}) `)

  const userId = await ensureUser(admin, definition.email, definition.name)

  // Business ------------------------------------------------------------------
  const { data: existing } = await admin
    .from('businesses')
    .select('id')
    .eq('slug', definition.slug)
    .maybeSingle()

  const businessPayload = {
    owner_id: userId,
    name: definition.name,
    slug: definition.slug,
    category: definition.category,
    city: definition.city,
    country: 'ES',
    timezone: 'Europe/Madrid',
    currency: 'EUR',
    locale: 'es',
    support_email: definition.email,
    primary_color: definition.primaryColor,
    text_color: definition.textColor,
    plan: definition.plan,
    subscription_status: 'active',
    plan_interval: 'month',
    trial_ends_at: null,
  }

  let businessId: string
  if (existing) {
    businessId = existing.id as string
    await admin.from('businesses').update(businessPayload).eq('id', businessId)
  } else {
    const { data, error } = await admin
      .from('businesses')
      .insert(businessPayload)
      .select('id')
      .single()
    if (error) fail(`Could not create ${definition.name}: ${error.message}`)
    businessId = data.id as string
  }

  await admin.from('team_members').upsert(
    { business_id: businessId, user_id: userId, role: 'owner', status: 'active' },
    { onConflict: 'business_id,user_id' }
  )

  // Provisioning creates the default location, program and earning rules through the
  // same function a real signup uses.
  await admin.rpc('passimo_provision_business', { p_business_id: businessId })

  await seedLocations(admin, businessId, definition)
  const programId = await seedProgram(admin, businessId, definition)
  await seedRewards(admin, businessId, programId, definition)
  await seedWalletConfig(admin, businessId, definition)
  const customerIds = await seedCustomers(admin, businessId, programId, definition)
  await seedProximity(admin, businessId, definition, customerIds)
  await seedCampaigns(admin, businessId, definition)
  await seedNotifications(admin, businessId)

  console.log(`— ${customerIds.length} customers`)
}

async function seedLocations(
  admin: Admin,
  businessId: string,
  definition: DemoBusiness
): Promise<void> {
  // The provisioning function created one location named after the business; the first
  // demo location replaces it so the estate reads correctly rather than having a
  // duplicate "Madrid Coffee" alongside "Calle Mayor".
  const { data: provisioned } = await admin
    .from('locations')
    .select('id')
    .eq('business_id', businessId)
    .eq('is_default', true)
    .maybeSingle()

  for (const [index, location] of definition.locations.entries()) {
    const payload = {
      business_id: businessId,
      name: location.name,
      address: location.address,
      city: location.city,
      postal_code: location.postalCode,
      country: 'ES',
      lat: location.lat,
      lng: location.lng,
      geo_radius_m: location.radius,
      notification_radius_m: Math.round(location.radius * 1.5),
      trigger_on_entry: true,
      trigger_on_dwell: definition.template === 'gym',
      dwell_minutes: definition.template === 'gym' ? 20 : 5,
      geofence_enabled: true,
      is_visible: true,
      sort_order: index,
      timezone: 'Europe/Madrid',
      geocode_source: 'demo_seed',
      geocoded_at: new Date().toISOString(),
      opening_hours: openingHoursFor(definition.template),
      relevant_text: relevantTextFor(definition, location.name),
      external_ref: `${definition.slug}-${index + 1}`,
    }

    const { data: match } = await admin
      .from('locations')
      .select('id')
      .eq('business_id', businessId)
      .eq('external_ref', payload.external_ref)
      .maybeSingle()

    if (match) {
      await admin.from('locations').update(payload).eq('id', match.id)
    } else if (index === 0 && provisioned) {
      await admin.from('locations').update(payload).eq('id', provisioned.id)
    } else {
      await admin.from('locations').insert(payload)
    }
  }

  // Exactly one primary, enforced by a partial unique index.
  const { data: first } = await admin
    .from('locations')
    .select('id')
    .eq('business_id', businessId)
    .eq('external_ref', `${definition.slug}-1`)
    .maybeSingle()

  if (first) {
    await admin
      .from('locations')
      .update({ is_default: false })
      .eq('business_id', businessId)
      .neq('id', first.id)
    await admin.from('locations').update({ is_default: true }).eq('id', first.id)
  }
}

function openingHoursFor(template: string): Record<string, [string, string][]> {
  if (template === 'gym') {
    return {
      mon: [['06:30', '22:30']],
      tue: [['06:30', '22:30']],
      wed: [['06:30', '22:30']],
      thu: [['06:30', '22:30']],
      fri: [['06:30', '22:00']],
      sat: [['08:00', '20:00']],
      sun: [['09:00', '18:00']],
    }
  }
  if (template === 'bakery') {
    // A split shift, which is the normal case in Spain and the reason the schema
    // supports several ranges per day.
    return {
      mon: [['07:30', '14:00'], ['17:00', '20:30']],
      tue: [['07:30', '14:00'], ['17:00', '20:30']],
      wed: [['07:30', '14:00'], ['17:00', '20:30']],
      thu: [['07:30', '14:00'], ['17:00', '20:30']],
      fri: [['07:30', '14:00'], ['17:00', '21:00']],
      sat: [['08:00', '14:30']],
    }
  }
  if (template === 'barber_shop') {
    return {
      tue: [['10:00', '20:00']],
      wed: [['10:00', '20:00']],
      thu: [['10:00', '20:00']],
      fri: [['10:00', '21:00']],
      sat: [['09:00', '15:00']],
    }
  }
  return {
    mon: [['07:00', '19:00']],
    tue: [['07:00', '19:00']],
    wed: [['07:00', '19:00']],
    thu: [['07:00', '19:00']],
    fri: [['07:00', '20:00']],
    sat: [['08:30', '20:00']],
    sun: [['09:00', '15:00']],
  }
}

function relevantTextFor(definition: DemoBusiness, locationName: string): string {
  switch (definition.template) {
    case 'coffee_shop':
      return `Your coffee card is ready at ${locationName}`
    case 'bakery':
      return `Fresh out of the oven at ${locationName}`
    case 'gym':
      return `You are near ${locationName} — keep the streak alive`
    default:
      return `You are near ${locationName}`
  }
}

async function seedProgram(
  admin: Admin,
  businessId: string,
  definition: DemoBusiness
): Promise<string> {
  const { data: program } = await admin
    .from('loyalty_programs')
    .select('id')
    .eq('business_id', businessId)
    .eq('is_default', true)
    .maybeSingle()

  const payload = {
    name: definition.program.name,
    type: definition.program.type,
    unit_singular: definition.program.unitSingular,
    unit_plural: definition.program.unitPlural,
    goal_amount: definition.program.goal,
    reward_description: definition.program.reward,
    reset_on_reward: definition.program.type === 'stamps',
  }

  if (program) {
    await admin.from('loyalty_programs').update(payload).eq('id', program.id)
    return program.id as string
  }

  const { data, error } = await admin
    .from('loyalty_programs')
    .insert({ ...payload, business_id: businessId, is_default: true })
    .select('id')
    .single()
  if (error) fail(`Could not create the program for ${definition.name}: ${error.message}`)
  return data.id as string
}

async function seedRewards(
  admin: Admin,
  businessId: string,
  programId: string,
  definition: DemoBusiness
): Promise<void> {
  for (const [index, reward] of definition.rewards.entries()) {
    const { data: existing } = await admin
      .from('rewards')
      .select('id')
      .eq('business_id', businessId)
      .eq('name', reward.name)
      .maybeSingle()

    const payload = {
      business_id: businessId,
      program_id: programId,
      name: reward.name,
      description: reward.description,
      cost: reward.cost,
      type: 'free_item',
      is_active: true,
      sort_order: index,
    }

    if (existing) await admin.from('rewards').update(payload).eq('id', existing.id)
    else await admin.from('rewards').insert(payload)
  }
}

async function seedWalletConfig(
  admin: Admin,
  businessId: string,
  definition: DemoBusiness
): Promise<void> {
  await admin.from('wallet_settings').upsert(
    {
      business_id: businessId,
      proximity_enabled: true,
      // Starter does not include geofencing, so its settings row honestly reflects
      // that — a demo that shows a Starter merchant using a Growth feature teaches
      // the wrong thing about the plans.
      geofencing_enabled: definition.plan !== 'starter',
      apple_lock_screen_suggestions: true,
      google_wallet_suggestions: true,
      nearby_recommendations: true,
      automatic_pass_updates: true,
      dynamic_pass_content: true,
      reward_notifications: true,
      loyalty_reminders: definition.template !== 'pharmacy',
      brand_color: definition.primaryColor,
      brand_text_color: definition.textColor,
      applied_template: definition.template,
      applied_template_at: new Date().toISOString(),
    },
    { onConflict: 'business_id' }
  )

  if (definition.plan === 'starter') return

  // Campaigns, from the industry template. Active here rather than paused: the point
  // of a demo environment is that the screens have data on them.
  const campaigns = campaignsFor(definition)
  for (const campaign of campaigns) {
    const { data: existing } = await admin
      .from('proximity_campaigns')
      .select('id')
      .eq('business_id', businessId)
      .eq('name', campaign.name)
      .maybeSingle()

    const payload = { ...campaign, business_id: businessId }
    if (existing) await admin.from('proximity_campaigns').update(payload).eq('id', existing.id)
    else await admin.from('proximity_campaigns').insert(payload)
  }

  const rules = rulesFor(definition)
  for (const rule of rules) {
    const { data: existing } = await admin
      .from('proximity_rules')
      .select('id')
      .eq('business_id', businessId)
      .eq('template_key', rule.template_key)
      .maybeSingle()

    const payload = { ...rule, business_id: businessId }
    if (existing) await admin.from('proximity_rules').update(payload).eq('id', existing.id)
    else await admin.from('proximity_rules').insert(payload)
  }
}

/**
 * Typed as a row bag rather than inferred.
 *
 * The three branches return different sets of columns — a coffee campaign has trading
 * hours, a gym campaign has a dwell threshold — and the inferred union is not
 * assignable to an insert. Declaring the shape is both what makes it compile and an
 * honest statement that these are database rows, not a domain type.
 */
function campaignsFor(definition: DemoBusiness): Array<Record<string, unknown>> {
  const shared = {
    status: 'active' as const,
    all_locations: true,
    channels: ['wallet'],
    text_color: definition.textColor,
    background_color: definition.primaryColor,
  }

  if (definition.template === 'coffee_shop' || definition.template === 'bakery') {
    return [
      {
        ...shared,
        name: 'Morning regulars',
        kind: 'coffee_morning',
        trigger: 'entry',
        title: 'Your morning coffee is ready',
        message: 'You are around the corner, {first_name}. Your usual and a stamp on the card.',
        emoji: '☕',
        cta_label: 'Open my card',
        weekdays: [1, 2, 3, 4, 5],
        start_time: '07:00',
        end_time: '10:30',
        priority: 20,
        cooldown_hours: 20,
        sent_count: between(180, 340),
        impression_count: between(120, 260),
        click_count: between(40, 110),
        visit_count: between(28, 80),
        redemption_count: between(8, 30),
        revenue_cents: between(18_000, 62_000),
      },
      {
        ...shared,
        name: 'Reward waiting',
        kind: 'reward_ready',
        trigger: 'nearby',
        title: 'Your free {reward} is waiting',
        message: 'You have earned it. Show your card at the counter.',
        emoji: '🎁',
        cta_label: 'Claim now',
        radius_m: 250,
        priority: 40,
        cooldown_hours: 24,
        eligibility: { requires_claimable_reward: true },
        reward_description: definition.program.reward,
        sent_count: between(40, 90),
        impression_count: between(30, 70),
        click_count: between(18, 44),
        visit_count: between(14, 36),
        redemption_count: between(10, 28),
        revenue_cents: between(9_000, 24_000),
      },
    ]
  }

  if (definition.template === 'gym') {
    return [
      {
        ...shared,
        name: 'You are close — train today',
        kind: 'custom',
        trigger: 'nearby',
        title: 'You are two minutes away',
        message: 'A short session still counts, {first_name}. Keep the streak alive.',
        emoji: '💪',
        cta_label: 'Check in',
        radius_m: 800,
        min_days_since_visit: 6,
        priority: 30,
        cooldown_hours: 72,
        sent_count: between(220, 420),
        impression_count: between(160, 320),
        click_count: between(60, 150),
        visit_count: between(40, 110),
        redemption_count: between(6, 22),
        revenue_cents: between(30_000, 90_000),
      },
      {
        ...shared,
        name: 'Off-peak double points',
        kind: 'double_points',
        trigger: 'nearby',
        title: 'Double points this afternoon',
        message: 'Quiet floor, twice the points. Until 16:00.',
        emoji: '⚡',
        cta_label: 'See my card',
        radius_m: 1_000,
        weekdays: [1, 2, 3, 4, 5],
        start_time: '13:00',
        end_time: '16:00',
        priority: 20,
        cooldown_hours: 48,
        sent_count: between(90, 200),
        impression_count: between(60, 150),
        click_count: between(25, 70),
        visit_count: between(18, 50),
        redemption_count: between(4, 14),
        revenue_cents: between(12_000, 40_000),
      },
    ]
  }

  return [
    {
      ...shared,
      name: 'Time for a trim',
      kind: 'custom',
      trigger: 'nearby',
      title: 'Due for a trim, {first_name}?',
      message: 'It has been about four weeks. We have a chair free today.',
      emoji: '✂️',
      cta_label: 'Book now',
      radius_m: 400,
      min_days_since_visit: 26,
      priority: 30,
      cooldown_hours: 168,
      sent_count: between(120, 260),
      impression_count: between(90, 190),
      click_count: between(38, 96),
      visit_count: between(26, 70),
      redemption_count: between(8, 24),
      revenue_cents: between(22_000, 70_000),
    },
  ]
}

function rulesFor(definition: DemoBusiness) {
  const rules: Array<Record<string, unknown>> = [
    {
      template_key: 'reward_ready',
      name: 'Reward waiting nearby',
      description: 'When a customer with a claimable reward comes close, remind them.',
      is_active: true,
      priority: 10,
      cooldown_hours: 24,
      conditions: {
        all: [
          { fact: 'has_claimable_reward', op: 'is_true' },
          { fact: 'distance_meters', op: 'lte', value: definition.locations[0].radius },
        ],
      },
      actions: [{ type: 'notify_reward_available' }],
      match_count: between(12, 60),
      last_matched_at: daysAgo(between(1, 6)),
    },
    {
      template_key: 'birthday',
      name: 'Birthday reward',
      description: 'On a customer’s birthday, activate their birthday treat.',
      is_active: true,
      priority: 5,
      cooldown_hours: 168,
      conditions: { all: [{ fact: 'is_birthday', op: 'is_true' }] },
      actions: [
        {
          type: 'send_wallet_notification',
          title: 'Happy birthday!',
          message: 'Your birthday treat is waiting for you today.',
          emoji: '🎂',
          cta_label: 'See your reward',
        },
      ],
      match_count: between(3, 20),
      last_matched_at: daysAgo(between(1, 14)),
    },
  ]

  if (definition.plan === 'business' || definition.plan === 'pro') {
    rules.push({
      template_key: 'vip',
      name: 'VIP arrival',
      description: 'Alert the team when a VIP walks in.',
      is_active: true,
      priority: 1,
      cooldown_hours: 4,
      conditions: {
        all: [
          { fact: 'is_vip', op: 'is_true' },
          { fact: 'trigger', op: 'eq', value: 'entry' },
        ],
      },
      actions: [{ type: 'notify_staff', title: 'A VIP customer just arrived' }],
      match_count: between(2, 15),
      last_matched_at: daysAgo(between(1, 9)),
    })
  }

  return rules
}

async function seedCustomers(
  admin: Admin,
  businessId: string,
  programId: string,
  definition: DemoBusiness
): Promise<string[]> {
  const { count } = await admin
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)

  // Already seeded: reuse the existing cohort rather than doubling it.
  if ((count ?? 0) >= definition.customerCount) {
    const { data } = await admin
      .from('customers')
      .select('id')
      .eq('business_id', businessId)
      .limit(definition.customerCount)
    return (data ?? []).map((row) => row.id as string)
  }

  const { data: locations } = await admin
    .from('locations')
    .select('id')
    .eq('business_id', businessId)
    .order('sort_order')
  const locationIds = (locations ?? []).map((row) => row.id as string)

  const goal = definition.program.goal
  const customers: Array<Record<string, unknown>> = []
  const ledger: Array<Record<string, unknown>> = []
  const accounts: Array<Record<string, unknown>> = []
  const events: Array<Record<string, unknown>> = []

  for (let index = (count ?? 0); index < definition.customerCount; index += 1) {
    const firstName = pick(FIRST_NAMES)
    const lastName = pick(LAST_NAMES)
    const customerId = randomUUID()

    // A realistic distribution: a long tail of one-visit customers, a solid middle,
    // and a small group of regulars. A uniform distribution would make retention
    // analytics look like nothing a real business has ever seen.
    const cohort = random()
    const visits = cohort < 0.45 ? between(1, 2) : cohort < 0.85 ? between(3, 9) : between(10, 48)
    const joinedDaysAgo = between(visits * 4, 400)
    const lastVisitDaysAgo = cohort < 0.45 ? between(30, 200) : between(0, 21)

    customers.push({
      id: customerId,
      business_id: businessId,
      email: `${firstName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}.${lastName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')}${index}@example.com`,
      name: `${firstName} ${lastName}`,
      first_name: firstName,
      last_name: lastName,
      phone: `+346${between(10_000_000, 99_999_999)}`,
      locale: 'es',
      status: 'active',
      is_vip: cohort > 0.94,
      /*
       * Left to the recompute below rather than set here. `visit_count`,
       * `lifetime_spend` and `average_ticket` are all derived from
       * `activity_events` by `passimo_recompute_customer_stats`, and any value
       * written directly is a value the first real scan will overwrite.
       */
      birthday: `19${between(70, 99)}-${String(between(1, 12)).padStart(2, '0')}-${String(
        between(1, 28)
      ).padStart(2, '0')}`,
      created_at: daysAgo(joinedDaysAgo),
      last_visit: daysAgo(lastVisitDaysAgo),
      signup_location_id: locationIds.length > 0 ? pick(locationIds) : null,
      referral_code: `${definition.slug.slice(0, 3).toUpperCase()}${index.toString(36).toUpperCase().padStart(4, '0')}`,
      wallet_auth_token: randomUUID().replace(/-/g, ''),
      // Roughly half of enrolled customers install the pass, which is what actually
      // happens — and the reason "no pass installed" is a normal skip reason rather
      // than an error.
      google_wallet_saved_at: chance(0.28) ? daysAgo(between(1, joinedDaysAgo)) : null,
    })

    /*
     * The account id is generated here rather than left to the column default,
     * because every ledger entry has to point at it: `loyalty_ledger.account_id`
     * is `not null`, and a ledger row without it is the difference between a
     * customer profile that shows "8 stamps, here is how you got them" and one
     * that shows a balance with no history behind it.
     */
    const accountId = randomUUID()

    /*
     * The ledger is built first and the balance derived from it, not the other way
     * round. Picking a balance and then inventing entries produces a demo where
     * the number on the card does not equal the sum of its history — which is
     * precisely the inconsistency a merchant evaluating the product would find
     * within a minute of opening a customer profile.
     */
    /*
     * Up to fourteen entries, not six. A stamp card with a goal of eight cannot be
     * completed in six visits, so the old cap meant the demo contained zero
     * redemptions — and a loyalty product whose demo has never rewarded anybody
     * is not demonstrating the thing it sells.
     */
    const entryCount = Math.min(visits, 14)
    const entryDays = Array.from({ length: entryCount }, () =>
      between(lastVisitDaysAgo, joinedDaysAgo)
    ).sort((a, b) => b - a) // Descending days-ago = chronological order.

    let running = 0
    let lifetimeEarned = 0

    entryDays.forEach((days, entry) => {
      const at = daysAgo(days)
      const amount = definition.program.type === 'stamps' ? 1 : between(5, 40)
      const ticket = between(4, 22)
      running += amount
      lifetimeEarned += amount

      ledger.push({
        business_id: businessId,
        program_id: programId,
        customer_id: customerId,
        account_id: accountId,
        entry_type: 'earn',
        amount,
        balance_after: running,
        reason: 'Visit',
        location_id: locationIds.length > 0 ? pick(locationIds) : null,
        created_at: at,
        idempotency_key: `demo:${customerId}:earn:${entry}`,
      })

      /*
       * Type `purchase` with a real amount, not a bare `visit`.
       *
       * `passimo_recompute_customer_stats` derives `lifetime_spend`,
       * `average_ticket` and `last_purchase_at` by summing `activity_events`
       * where `type = 'purchase'`. Seeding visits with no amount while writing a
       * `lifetime_spend` onto the customer row meant the two disagreed from the
       * start, and the first real scan — which triggers a recompute — silently
       * reset every seeded customer's spend to zero. Deriving both from the same
       * events is the only version of this that survives the product running.
       */
      events.push({
        business_id: businessId,
        customer_id: customerId,
        type: 'purchase',
        amount: ticket,
        currency: 'EUR',
        location_id: locationIds.length > 0 ? pick(locationIds) : null,
        occurred_at: at,
        idempotency_key: `demo:${customerId}:visit:${entry}`,
      })

      /*
       * A customer who crossed the goal and cashed it in. Without these the demo
       * has no redemptions at all, so the reward-performance and redemption-rate
       * panels render as zeroes on every plan.
       */
      if (running >= goal && chance(0.55)) {
        running -= goal
        ledger.push({
          business_id: businessId,
          program_id: programId,
          customer_id: customerId,
          account_id: accountId,
          entry_type: 'redeem',
          amount: -goal,
          balance_after: running,
          reason: definition.program.reward,
          location_id: locationIds.length > 0 ? pick(locationIds) : null,
          created_at: at,
          idempotency_key: `demo:${customerId}:redeem:${entry}`,
        })
      }
    })

    accounts.push({
      id: accountId,
      business_id: businessId,
      program_id: programId,
      customer_id: customerId,
      balance: running,
      lifetime_earned: lifetimeEarned,
    })
  }

  await insertInBatches(admin, 'customers', customers)
  await insertInBatches(admin, 'loyalty_accounts', accounts)
  await insertInBatches(admin, 'loyalty_ledger', ledger)
  await insertInBatches(admin, 'activity_events', events)

  /*
   * Derive the behavioural rollups with the same function the product uses, so
   * the demo's visit counts, spend, average ticket and days-between-visits are
   * the numbers the application would compute — not a second, parallel set that
   * drifts the moment anyone scans a card.
   */
  // One statement, not 2,660 round trips: the whole point of the seed being fast
  // is that a developer re-runs it without thinking about it.
  await query('select passimo_recompute_customer_stats(id) from customers where business_id = $1', [
    businessId,
  ])

  return customers.map((customer) => customer.id as string)
}

/**
 * Wallet events, notifications and geofence crossings.
 *
 * Written directly rather than through the engine: the engine's guards (cooldowns,
 * quiet hours, frequency caps) exist to stop bursts, and a seed script legitimately
 * needs a burst. Going through `reportPosition` would produce one event per customer
 * and then correctly refuse the rest.
 */
async function seedProximity(
  admin: Admin,
  businessId: string,
  definition: DemoBusiness,
  customerIds: string[]
): Promise<void> {
  if (definition.plan === 'starter' || customerIds.length === 0) return

  const [{ data: locations }, { data: campaigns }] = await Promise.all([
    admin.from('locations').select('id').eq('business_id', businessId),
    admin.from('proximity_campaigns').select('id').eq('business_id', businessId),
  ])

  const locationIds = (locations ?? []).map((row) => row.id as string)
  const campaignIds = (campaigns ?? []).map((row) => row.id as string)
  if (locationIds.length === 0) return

  const walletEvents: Array<Record<string, unknown>> = []
  const notifications: Array<Record<string, unknown>> = []

  const sampleSize = Math.min(customerIds.length, 120)

  for (let index = 0; index < sampleSize; index += 1) {
    const customerId = customerIds[index]
    const locationId = pick(locationIds)
    const campaignId = campaignIds.length > 0 ? pick(campaignIds) : null
    const platform = pick(['apple', 'google', 'web'] as const)
    const occurredAt = daysAgo(between(0, 29))

    walletEvents.push({
      business_id: businessId,
      customer_id: customerId,
      location_id: locationId,
      campaign_id: campaignId,
      type: 'geofence_enter',
      platform,
      distance_m: between(20, definition.locations[0].radius),
      occurred_at: occurredAt,
    })

    // The funnel narrows realistically: not every crossing produces a notification,
    // not every notification is seen, not every impression converts.
    if (!chance(0.62)) continue

    const notificationId = randomUUID()
    const sentAt = occurredAt

    notifications.push({
      id: notificationId,
      business_id: businessId,
      customer_id: customerId,
      campaign_id: campaignId,
      location_id: locationId,
      channel: 'wallet',
      platform,
      status: chance(0.82) ? 'sent' : 'skipped',
      skip_reason: chance(0.82) ? null : pick(['no_pass_installed', 'quiet_hours', 'daily_cap']),
      title: 'Your reward is waiting',
      message: 'You are nearby — show your card at the counter.',
      emoji: '🎁',
      dedupe_key: `demo:${customerId}:${index}`,
      sent_at: sentAt,
      created_at: sentAt,
    })

    const sourceEventId = randomUUID()
    walletEvents.push({
      id: sourceEventId,
      business_id: businessId,
      customer_id: customerId,
      location_id: locationId,
      campaign_id: campaignId,
      type: 'notification_sent',
      platform,
      occurred_at: sentAt,
    })

    if (chance(0.55)) {
      walletEvents.push({
        business_id: businessId,
        customer_id: customerId,
        location_id: locationId,
        campaign_id: campaignId,
        type: 'notification_impression',
        platform,
        source_event_id: sourceEventId,
        occurred_at: sentAt,
      })
    }

    if (chance(0.3)) {
      walletEvents.push({
        business_id: businessId,
        customer_id: customerId,
        location_id: locationId,
        campaign_id: campaignId,
        type: 'notification_click',
        platform,
        source_event_id: sourceEventId,
        occurred_at: sentAt,
      })
    }

    // Visits carry `source_event_id` so the attribution and delay maths have real
    // input — the "average time to visit" column is otherwise permanently blank.
    if (chance(0.24)) {
      const visitAt = new Date(
        new Date(sentAt).getTime() + between(8, 210) * 60_000
      ).toISOString()

      walletEvents.push({
        business_id: businessId,
        customer_id: customerId,
        location_id: locationId,
        campaign_id: campaignId,
        type: 'store_visit',
        platform,
        source_event_id: sourceEventId,
        revenue_cents: between(350, 2_800),
        occurred_at: visitAt,
      })

      if (chance(0.4)) {
        walletEvents.push({
          business_id: businessId,
          customer_id: customerId,
          location_id: locationId,
          campaign_id: campaignId,
          type: 'reward_redeemed',
          platform,
          source_event_id: sourceEventId,
          occurred_at: visitAt,
        })
      }
    }

    if (chance(0.3)) {
      walletEvents.push({
        business_id: businessId,
        customer_id: customerId,
        type: 'pass_installed',
        platform,
        occurred_at: daysAgo(between(30, 200)),
      })
    }
  }

  await insertInBatches(admin, 'wallet_notifications', notifications, {
    conflictTarget: 'business_id,dedupe_key',
  })
  await insertInBatches(admin, 'wallet_events', walletEvents)

  // Apple pass registrations, so the counter and the sync path have devices to reach.
  const registrations = customerIds.slice(0, Math.floor(sampleSize * 0.35)).map((customerId) => ({
    business_id: businessId,
    customer_id: customerId,
    platform: 'apple',
    device_id: `demo-device-${customerId.slice(0, 8)}`,
    serial_number: customerId,
    push_token: `demo-token-${customerId.replace(/-/g, '').slice(0, 32)}`,
  }))
  await insertInBatches(admin, 'wallet_registrations', registrations, {
    conflictTarget: 'device_id,serial_number',
  })
}

async function seedNotifications(admin: Admin, businessId: string): Promise<void> {
  const { count } = await admin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
  if ((count ?? 0) > 0) return

  const { data: owner } = await admin
    .from('team_members')
    .select('user_id')
    .eq('business_id', businessId)
    .eq('role', 'owner')
    .maybeSingle()

  if (!owner?.user_id) return

  // The column is `kind`, not `type`. It was `type` here for a while and the
  // insert failed silently, which is why the demo bell was always empty —
  // `insertInBatches` now reports, and this goes through it for the same reason.
  await insertInBatches(admin, 'notifications', [
    {
      business_id: businessId,
      user_id: owner.user_id,
      kind: 'insight',
      title: 'Your morning campaign is your best performer',
      body: 'It brought 34 visits in the last 30 days — more than the other two combined.',
      url: '/dashboard/wallet',
      severity: 'success',
      created_at: daysAgo(1),
    },
    {
      business_id: businessId,
      user_id: owner.user_id,
      kind: 'customer',
      title: 'A VIP customer just arrived',
      body: 'Look after them.',
      url: '/dashboard/customers',
      severity: 'info',
      created_at: daysAgo(2),
    },
    {
      business_id: businessId,
      user_id: owner.user_id,
      kind: 'system',
      title: 'Wallet credentials are not configured',
      body: 'Cards cannot be issued until Apple and Google credentials are set on this deployment.',
      url: '/dashboard/wallet',
      severity: 'warning',
      created_at: daysAgo(4),
    },
  ])
}

/**
 * Marketing campaigns with real outcomes attached.
 *
 * Without these the Campaigns screen, the campaign-ROI panel and the
 * attributed-revenue column on the analytics page all render as zeroes, which
 * makes three of the product's strongest screens look unfinished in exactly the
 * environment built to show them off.
 *
 * The numbers are internally consistent: delivered ≥ opened ≥ clicked, attributed
 * visits below click count, revenue proportional to visits at the business's own
 * average ticket. Invented-but-inconsistent metrics are worse than none, because
 * a prospect who does the arithmetic stops trusting the rest of the screen.
 */
async function seedCampaigns(
  admin: Admin,
  businessId: string,
  definition: DemoBusiness
): Promise<void> {
  const { count } = await admin
    .from('campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
  if ((count ?? 0) > 0) return

  const { data: segments } = await admin
    .from('segments')
    .select('id, key')
    .eq('business_id', businessId)
  const segmentBy = (key: string) =>
    (segments ?? []).find((row) => row.key === key)?.id ?? null

  const audience = Math.max(20, Math.round(definition.customerCount * 0.4))

  const campaign = (input: {
    name: string
    type: string
    status: string
    subject: string
    body: string
    channels: string[]
    segmentKey?: string
    daysAgo: number
    reach: number
    openRate: number
    clickRate: number
  }) => {
    const delivered = Math.round(input.reach * 0.97)
    const opened = Math.round(delivered * input.openRate)
    const clicked = Math.round(opened * input.clickRate)
    const visits = Math.round(clicked * 0.42)
    const averageTicket = between(6, 24)

    return {
      business_id: businessId,
      name: input.name,
      type: input.type,
      status: input.status,
      channels: input.channels,
      segment_id: input.segmentKey ? segmentBy(input.segmentKey) : null,
      subject: input.subject,
      body_text: input.body,
      message: input.body,
      reach_count: input.reach,
      sent_count: input.status === 'completed' ? input.reach : 0,
      delivered_count: input.status === 'completed' ? delivered : 0,
      failed_count: input.status === 'completed' ? input.reach - delivered : 0,
      opened_count: input.status === 'completed' ? opened : 0,
      clicked_count: input.status === 'completed' ? clicked : 0,
      unsubscribed_count: input.status === 'completed' ? Math.round(delivered * 0.004) : 0,
      attributed_visits: input.status === 'completed' ? visits : 0,
      attributed_revenue: input.status === 'completed' ? visits * averageTicket : 0,
      estimated_cost: input.channels.includes('sms') ? input.reach * 0.045 : 0,
      created_at: daysAgo(input.daysAgo + 2),
      ...(input.status === 'completed'
        ? { started_at: daysAgo(input.daysAgo), completed_at: daysAgo(input.daysAgo) }
        : {}),
      ...(input.status === 'scheduled'
        ? { scheduled_at: new Date(Date.now() + 3 * 86_400_000).toISOString() }
        : {}),
    }
  }

  await insertInBatches(admin, 'campaigns', [
    campaign({
      name: 'Win back our regulars',
      type: 'winback',
      status: 'completed',
      subject: `We miss you at ${definition.name}`,
      body: `It has been a while. Your next visit to ${definition.name} earns double.`,
      channels: ['email'],
      segmentKey: 'at_risk',
      daysAgo: 24,
      reach: Math.round(audience * 0.45),
      openRate: 0.41,
      clickRate: 0.19,
    }),
    campaign({
      name: 'Birthday treat',
      type: 'birthday',
      status: 'active',
      subject: 'Something on us this month',
      body: 'Happy birthday. There is a free treat waiting on your card.',
      channels: ['email', 'wallet'],
      daysAgo: 60,
      reach: Math.round(audience * 0.08),
      openRate: 0.62,
      clickRate: 0.34,
    }),
    campaign({
      name: 'Weekend double stamps',
      type: 'double_stamp',
      status: 'completed',
      subject: 'Double stamps all weekend',
      body: 'Every visit counts twice this Saturday and Sunday.',
      channels: ['email', 'wallet'],
      daysAgo: 11,
      reach: audience,
      openRate: 0.48,
      clickRate: 0.22,
    }),
    campaign({
      name: 'VIP early access',
      type: 'promo',
      status: 'scheduled',
      subject: 'You get first look',
      body: 'Our regulars see the new menu before anyone else.',
      channels: ['email'],
      segmentKey: 'vip',
      daysAgo: 1,
      reach: Math.round(audience * 0.12),
      openRate: 0.58,
      clickRate: 0.31,
    }),
    campaign({
      name: 'How did we do?',
      type: 'nps',
      status: 'draft',
      subject: 'One question, ten seconds',
      body: 'How likely are you to recommend us to a friend?',
      channels: ['email'],
      daysAgo: 0,
      reach: Math.round(audience * 0.3),
      openRate: 0.4,
      clickRate: 0.25,
    }),
  ])
}

async function seedPlatformAdmin(admin: Admin): Promise<void> {
  for (const email of ADMIN_EMAILS) {
    process.stdout.write(`  · platform admin ${email} `)
    const userId = await ensureUser(admin, email, 'Passimo platform admin')
    const { error } = await admin
      .from('platform_admins')
      .upsert(
        { user_id: userId, email, display_name: 'Demo platform admin', scopes: ['*'] },
        { onConflict: 'user_id' }
      )
    console.log(error ? `— failed: ${error.message}` : '— ok')
  }
}

/**
 * Inserts in chunks.
 *
 * PostgREST rejects very large bodies, and one failed 5,000-row insert tells you
 * nothing about which row was bad. Chunking also means a partial seed is still a
 * usable seed.
 */
/**
 * Batched insert.
 *
 * `conflictTarget` opts a table into duplicate tolerance, which matters because
 * this script is idempotent by design: a re-run regenerates wallet registrations
 * and notifications whose natural keys already exist, and a duplicate there is
 * the expected outcome rather than a failure.
 *
 * Tables without a conflict target still report loudly, and report a total rather
 * than one line per batch. A rejected `loyalty_ledger` batch means the demo
 * environment has no point history — which is exactly the kind of thing that
 * scrolls past in twenty identical warnings and ships as "the analytics screens
 * look empty".
 */
async function insertInBatches(
  admin: Admin,
  table: string,
  rows: Array<Record<string, unknown>>,
  options: { size?: number; conflictTarget?: string } = {}
): Promise<void> {
  const size = options.size ?? 200
  let failed = 0
  let firstError: string | null = null

  for (let start = 0; start < rows.length; start += size) {
    const batch = rows.slice(start, start + size)
    const { error } = options.conflictTarget
      ? await admin
          .from(table)
          .upsert(batch, { onConflict: options.conflictTarget, ignoreDuplicates: true })
      : await admin.from(table).insert(batch)

    if (error) {
      failed += batch.length
      firstError ??= error.message
    }
  }

  if (failed > 0) {
    console.warn(`\n    ! ${table}: ${firstError} (${failed} of ${rows.length} rows skipped)`)
  }
}

main().catch((cause) => {
  console.error('\n  ✗ Seeding failed:', cause)
  process.exit(1)
})
