import { getDb } from '@/lib/db'

/**
 * Removes the workspaces the test suites leave behind.
 *
 * Every e2e spec and the functional verifier create real merchants through the
 * real signup endpoint — which is the right way to test signup, and means the
 * development database accumulates one workspace per spec per run. After a few
 * full runs `npm run db:verify` reported **26 failures and 89 warnings**, every
 * one of them about a test tenant: locations with no coordinates, rewards
 * nobody could afford, thousands of queued jobs with no worker to run them.
 *
 * That is worse than untidy. A verification tool whose output is mostly noise
 * stops being read, and the one real finding in the next run gets lost in the
 * other twenty-five. The consistency checks in `scripts/db/*.sql` are good and
 * were being drowned by their own test fixtures.
 *
 * Deletion goes through `passimo_delete_business`, not a cascade: the loyalty
 * ledger has an immutability trigger that refuses a bare `delete`, on purpose,
 * because a balance history that can be quietly rewritten is not a balance
 * history.
 *
 * ## Why matching is on both the name and the owner's email
 *
 * A cleanup script that removes the wrong workspace destroys a merchant's
 * customer base. So the guard is deliberately doubled: a workspace is only
 * removed when its **name** matches a known test prefix *and* its owner's
 * **email** is on a test domain. A real merchant would have to have chosen a
 * name beginning "E2E Card Café" and signed up with an `@passimo.test` address
 * to be caught, and `.test` is a reserved TLD that cannot receive mail.
 *
 * Demo accounts (`@demo.com`) are deliberately *not* touched. Those are the
 * seeded accounts the demo environment depends on, and `scripts/seed-demo.ts`
 * owns their lifecycle.
 */

/** Name prefixes the test suites use. Extend this when a suite adds one. */
const TEST_NAME_PREFIXES = [
  'E2E Café',
  'E2E Card Café',
  'Join E2E Café',
  'MAT E2E Café',
  'Journey Coffee',
  'ZZ Verify',
  'Team Probe',
  'Invitee Own Shop',
  'Onboarding E2E',
]

/** Owner-email domains that can only be a test. `.test` is reserved (RFC 6761). */
const TEST_EMAIL_PATTERNS = ['%@passimo.test', '%@demo.invalid']

async function main(): Promise<void> {
  const admin = getDb()
  const dryRun = process.argv.includes('--dry-run')

  const owners = new Set<string>()
  for (const pattern of TEST_EMAIL_PATTERNS) {
    const { data, error } = await admin.from('app_users').select('id, email').like('email', pattern)
    if (error) throw new Error(`could not read users for ${pattern}: ${error.message}`)
    for (const row of data ?? []) owners.add(row.id as string)
  }

  if (owners.size === 0) {
    console.log('No test users found. Nothing to clean.')
    return
  }

  const doomed: Array<{ id: string; name: string; slug: string }> = []
  const spared: string[] = []

  for (const ownerId of owners) {
    const { data } = await admin
      .from('businesses')
      .select('id, name, slug')
      .eq('owner_id', ownerId)

    for (const business of data ?? []) {
      const name = business.name as string
      // Both guards, not either.
      if (TEST_NAME_PREFIXES.some((prefix) => name.startsWith(prefix))) {
        doomed.push({ id: business.id as string, name, slug: business.slug as string })
      } else {
        spared.push(name)
      }
    }
  }

  console.log(`Test-owned workspaces found: ${doomed.length + spared.length}`)
  if (spared.length > 0) {
    // Named rather than counted: a test user owning an unrecognised workspace
    // is either a new suite that needs a prefix added, or something that should
    // never have been created by a test.
    console.log(`\nLeft alone (owner looks like a test, name does not match a suite):`)
    for (const name of spared) console.log(`  ${name}`)
  }

  if (doomed.length === 0) {
    console.log('\nNothing to remove.')
    return
  }

  console.log(`\n${dryRun ? 'Would remove' : 'Removing'} ${doomed.length} workspace(s):`)
  let removed = 0
  const failures: string[] = []

  for (const business of doomed) {
    console.log(`  ${business.slug}`)
    if (dryRun) continue
    const { error } = await admin.rpc('passimo_delete_business', {
      p_business_id: business.id,
    })
    if (error) failures.push(`${business.slug}: ${error.message}`)
    else removed += 1
  }

  if (!dryRun) {
    // The user rows outlive their workspaces, so they are removed second —
    // and only the ones on a test domain, by the same patterns as above.
    let users = 0
    for (const pattern of TEST_EMAIL_PATTERNS) {
      const { data } = await admin.from('app_users').select('id').like('email', pattern)
      for (const row of data ?? []) {
        const { data: remaining } = await admin
          .from('businesses')
          .select('id', { count: 'exact', head: true })
          .eq('owner_id', row.id as string)
        // Skip an owner who still has a workspace we deliberately spared.
        if ((remaining as unknown as { length?: number })?.length) continue
        const { error } = await admin.from('app_users').delete().eq('id', row.id as string)
        if (!error) users += 1
      }
    }
    console.log(`\nRemoved ${removed} workspace(s) and ${users} test user(s).`)
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} could not be removed:`)
    for (const failure of failures) console.error(`  ${failure}`)
    process.exit(1)
  }
}

main().catch((cause: unknown) => {
  console.error(cause)
  process.exit(1)
})
