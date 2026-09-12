import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addCustomerTags,
  listBusinessTags,
  setCustomerTags,
} from '@/lib/customers/tags'
import { listCustomers } from '@/lib/customers/service'
import { countSegment } from '@/lib/segments/resolve'
import {
  assertDatabaseReady,
  createCustomer,
  createTenant,
  dropTenant,
  shutdown,
  type TestTenant,
} from './helpers'

/**
 * Customer tags, against real rows.
 *
 * The gap these close: tags could be written *only* at enrolment or through a
 * CSV column. The profile rendered them as read-only badges, `?tag=` was a
 * supported list filter nothing in the UI could set, and segments offered a
 * "Tag is one of" condition a merchant had no way to populate. Three features
 * resting on a write path that shut the moment somebody became a customer.
 *
 * Integration rather than unit, because the parts that can be wrong are the
 * ones that cross the boundary: replacement semantics, the tenant scope on a
 * delete, and whether the segment compiler's tag predicate actually matches
 * what the writer wrote.
 */
describe('customer tags', () => {
  let tenant: TestTenant
  let other: TestTenant
  let customerId: string
  let otherCustomerId: string

  beforeAll(async () => {
    await assertDatabaseReady()
    tenant = await createTenant('tags')
    other = await createTenant('tags-other')
    customerId = await createCustomer(tenant.businessId, { name: 'Tagged Regular' })
    otherCustomerId = await createCustomer(other.businessId, { name: 'Somebody Else' })
  })

  afterAll(async () => {
    await dropTenant(tenant)
    await dropTenant(other)
    await shutdown()
  })

  it('adds tags and lists them back on the customer', async () => {
    await addCustomerTags(tenant.businessId, customerId, ['wholesale', 'no nuts'])

    const { customers } = await listCustomers({
      businessId: tenant.businessId,
      sort: 'recent',
      limit: 10,
      offset: 0,
    })
    const found = customers.find((customer) => customer.id === customerId)
    expect(found?.tags.map((tag) => tag.name).sort()).toEqual(['no nuts', 'wholesale'])
  })

  it('offers the business vocabulary for the filter and the editor', async () => {
    const vocabulary = await listBusinessTags(tenant.businessId)
    expect(vocabulary).toContain('wholesale')
    expect(vocabulary).toContain('no nuts')
  })

  it('replaces rather than appends, so a tag can be removed', async () => {
    /*
     * The property an append-only endpoint cannot express. Without it the
     * profile editor is a tag *adder*: pressing × on a chip would do nothing.
     */
    await setCustomerTags(tenant.businessId, customerId, ['wholesale'])

    const { customers } = await listCustomers({
      businessId: tenant.businessId,
      sort: 'recent',
      limit: 10,
      offset: 0,
    })
    const found = customers.find((customer) => customer.id === customerId)
    expect(found?.tags.map((tag) => tag.name)).toEqual(['wholesale'])
  })

  it('clears every tag when given an empty set', async () => {
    await setCustomerTags(tenant.businessId, customerId, [])

    const { customers } = await listCustomers({
      businessId: tenant.businessId,
      sort: 'recent',
      limit: 10,
      offset: 0,
    })
    expect(customers.find((customer) => customer.id === customerId)?.tags).toEqual([])

    // Restored for the filter tests below.
    await setCustomerTags(tenant.businessId, customerId, ['wholesale'])
  })

  it('folds case to one tag rather than creating two', async () => {
    await setCustomerTags(tenant.businessId, customerId, ['Wholesale', 'wholesale', 'WHOLESALE'])
    const { customers } = await listCustomers({
      businessId: tenant.businessId,
      sort: 'recent',
      limit: 10,
      offset: 0,
    })
    expect(customers.find((customer) => customer.id === customerId)?.tags).toHaveLength(1)
  })

  it('filters the customer list by tag', async () => {
    // `?tag=` has been on this endpoint all along with nothing able to set it.
    const matching = await listCustomers({
      businessId: tenant.businessId,
      tag: 'Wholesale',
      sort: 'recent',
      limit: 10,
      offset: 0,
    })
    expect(matching.customers.map((customer) => customer.id)).toContain(customerId)

    const missing = await listCustomers({
      businessId: tenant.businessId,
      tag: 'definitely-not-a-tag',
      sort: 'recent',
      limit: 10,
      offset: 0,
    })
    expect(missing.customers).toHaveLength(0)
    expect(missing.total).toBe(0)
  })

  it('is matched by the segment compiler, closing the loop', async () => {
    /*
     * The reason tags matter beyond a badge: a merchant tags people so they can
     * be *reached*. If the writer and the segment predicate disagree, the tag
     * is decoration.
     */
    const count = await countSegment(tenant.businessId, {
      match: 'all',
      conditions: [{ field: 'tag', operator: 'in', value: ['Wholesale'] }],
    })
    expect(count).toBe(1)

    const none = await countSegment(tenant.businessId, {
      match: 'all',
      conditions: [{ field: 'tag', operator: 'not_in', value: ['Wholesale'] }],
    })
    expect(none).toBe(0)
  })

  it('never leaks a tag across tenants', async () => {
    await setCustomerTags(other.businessId, otherCustomerId, ['wholesale'])

    // Same word, two businesses, two rows — and neither list sees the other.
    const mine = await listCustomers({
      businessId: tenant.businessId,
      tag: 'wholesale',
      sort: 'recent',
      limit: 10,
      offset: 0,
    })
    expect(mine.customers.map((customer) => customer.id)).toEqual([customerId])

    const theirs = await listCustomers({
      businessId: other.businessId,
      tag: 'wholesale',
      sort: 'recent',
      limit: 10,
      offset: 0,
    })
    expect(theirs.customers.map((customer) => customer.id)).toEqual([otherCustomerId])

    /*
     * And clearing one tenant's tags must not touch the other's. `setCustomerTags`
     * deletes, and an unfiltered delete on a shared table is the one mistake in
     * that function that would actually matter.
     */
    await setCustomerTags(tenant.businessId, customerId, [])
    const stillTheirs = await listCustomers({
      businessId: other.businessId,
      tag: 'wholesale',
      sort: 'recent',
      limit: 10,
      offset: 0,
    })
    expect(stillTheirs.customers.map((customer) => customer.id)).toEqual([otherCustomerId])
  })
})
