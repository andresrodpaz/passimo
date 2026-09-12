import 'server-only'
import { getDb } from '@/lib/db'

/**
 * Customer tags.
 *
 * One implementation, because there were already two — an inline block in
 * `POST /api/v1/customers` and `applyTags` in `lib/customers/import.ts` — and
 * neither was reachable from the one place a merchant would look for it.
 *
 * What the product could do before this file: tag somebody *at the moment they
 * were created*, or tag them in bulk through a CSV column. What it could not do:
 * tag a regular who was already a customer. The profile rendered their tags as
 * read-only badges, the customer list accepted a `?tag=` filter that nothing in
 * the UI could set, and segments offered a "Tag is one of" condition a merchant
 * had no way to populate. Three features leaning on a write path that existed
 * only during enrolment.
 *
 * Tags are per-business by construction: `tags` is unique on
 * `(business_id, name)` and `customer_tags` carries `business_id`, so one
 * merchant's "wholesale" is never another's.
 */

/** Trimmed, de-duplicated, case-insensitively unique, and capped. */
export function normalizeTagNames(names: readonly string[]): string[] {
  const seen = new Map<string, string>()
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, ' ')
    if (!name) continue
    // Keyed on the folded form so "VIP" and "vip" cannot become two tags, but
    // the merchant's own capitalisation is what gets stored.
    const key = name.toLocaleLowerCase()
    if (!seen.has(key)) seen.set(key, name.slice(0, 60))
  }
  return [...seen.values()].slice(0, 20)
}

/**
 * Adds tags to a customer, creating any that do not exist yet.
 *
 * Additive. Used by enrolment and CSV import, where the caller is contributing
 * tags rather than declaring the complete set.
 */
export async function addCustomerTags(
  businessId: string,
  customerId: string,
  names: readonly string[]
): Promise<void> {
  const ids = await resolveTagIds(businessId, names)
  if (ids.length === 0) return

  const admin = getDb()
  for (const tagId of ids) {
    await admin.from('customer_tags').upsert(
      { customer_id: customerId, tag_id: tagId, business_id: businessId },
      { onConflict: 'customer_id,tag_id', ignoreDuplicates: true }
    )
  }
}

/**
 * Turns tag names into tag ids, reusing an existing tag whatever its case.
 *
 * The case-insensitive lookup is the whole point, and doing it here rather than
 * with a plain upsert is not fussiness. `tags` is unique on
 * `(business_id, name)` and **PostgreSQL compares that case-sensitively**, so
 * upserting "Wholesale" against a stored "wholesale" inserts a *second* row.
 * The customer then carries two chips spelled differently, the filter offers
 * both, and each matches a different half of the people the merchant meant.
 *
 * `normalizeTagNames` already folds duplicates *within one request*; this folds
 * against what the business has used before, which is the case that actually
 * happens — somebody types "Wholesale" three weeks after typing "wholesale".
 */
async function resolveTagIds(businessId: string, names: readonly string[]): Promise<string[]> {
  const wanted = normalizeTagNames(names)
  if (wanted.length === 0) return []

  const admin = getDb()
  const { data: existing } = await admin
    .from('tags')
    .select('id, name')
    .eq('business_id', businessId)
    .limit(500)

  const byFoldedName = new Map<string, string>()
  for (const row of existing ?? []) {
    byFoldedName.set(String(row.name).toLocaleLowerCase(), row.id as string)
  }

  const ids: string[] = []
  for (const name of wanted) {
    const found = byFoldedName.get(name.toLocaleLowerCase())
    if (found) {
      ids.push(found)
      continue
    }

    const { data: created } = await admin
      .from('tags')
      .upsert({ business_id: businessId, name }, { onConflict: 'business_id,name' })
      .select('id')
      .maybeSingle()

    if (created) {
      ids.push(created.id as string)
      byFoldedName.set(name.toLocaleLowerCase(), created.id as string)
    }
  }
  return ids
}

/**
 * Makes the customer's tags exactly `names`.
 *
 * Replacing rather than adding is what the profile editor needs: a merchant who
 * removes a chip means *remove it*, and an additive-only endpoint would make
 * removal impossible — which is how a tag editor becomes a tag adder.
 *
 * An empty array is a legitimate instruction: it clears every tag.
 */
export async function setCustomerTags(
  businessId: string,
  customerId: string,
  names: readonly string[]
): Promise<string[]> {
  const admin = getDb()
  const wantedIds = await resolveTagIds(businessId, names)

  await addCustomerTags(businessId, customerId, names)

  /*
   * Then drop whatever is no longer wanted.
   *
   * Compared by **tag id**, not by folded name. Folding was the obvious version
   * and it hid the case bug rather than handling it: with "wholesale" stored and
   * "Wholesale" requested, both fold to the same string, so both survived and
   * the customer ended up carrying two chips for one idea.
   *
   * Scoped by `business_id` as well as `customer_id`. The tenant filter is
   * redundant given the customer id, and it stays because an unfiltered delete
   * on a multi-tenant table is the one mistake in this file that would matter.
   */
  const { data: current } = await admin
    .from('customer_tags')
    .select('tag_id')
    .eq('business_id', businessId)
    .eq('customer_id', customerId)

  const keep = new Set(wantedIds)
  const stale = (current ?? [])
    .map((row) => row.tag_id as string)
    .filter((tagId) => !keep.has(tagId))

  for (const tagId of stale) {
    await admin
      .from('customer_tags')
      .delete()
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .eq('tag_id', tagId)
  }

  return normalizeTagNames(names)
}

/** Every tag this business has ever used, for the profile editor's suggestions. */
export async function listBusinessTags(businessId: string): Promise<string[]> {
  const admin = getDb()
  const { data } = await admin
    .from('tags')
    .select('name')
    .eq('business_id', businessId)
    .order('name', { ascending: true })
    .limit(200)

  return (data ?? []).map((row) => row.name as string)
}
