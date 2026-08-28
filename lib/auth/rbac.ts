/**
 * Role-based access control.
 *
 * Permissions are the unit of authorisation everywhere in the app; roles are
 * only a bundle of permissions. Adding a capability means adding a permission
 * and granting it to roles — never sprinkling `role === 'owner'` checks.
 */

export const ROLES = ['owner', 'admin', 'manager', 'staff', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS = [
  // Point of sale
  'loyalty:earn',
  'loyalty:redeem',
  'loyalty:adjust',
  // Customers
  'customers:read',
  'customers:write',
  'customers:delete',
  'customers:export',
  'customers:import',
  // Programs & rewards
  'programs:read',
  'programs:write',
  // Marketing
  'campaigns:read',
  'campaigns:write',
  'campaigns:send',
  'automations:write',
  // Store locations and wallet proximity. Separate from `settings:*` because a
  // shift manager who should be able to correct their own store's opening hours
  // has no business changing the billing email, and one permission for both
  // forces that choice.
  'locations:read',
  'locations:write',
  'wallet:read',
  'wallet:write',
  // Analytics & AI
  'analytics:read',
  'ai:use',
  // Platform administration
  'settings:read',
  'settings:write',
  'team:manage',
  'billing:manage',
  'integrations:manage',
  'apikeys:manage',
  'audit:read',
] as const
export type Permission = (typeof PERMISSIONS)[number]

const STAFF: Permission[] = [
  'loyalty:earn',
  'loyalty:redeem',
  'customers:read',
  'customers:write',
  'programs:read',
  'campaigns:read',
  'analytics:read',
  'settings:read',
  'locations:read',
  'wallet:read',
]

const MANAGER: Permission[] = [
  ...STAFF,
  'loyalty:adjust',
  'customers:export',
  'customers:import',
  'programs:write',
  'campaigns:write',
  'campaigns:send',
  'automations:write',
  'ai:use',
  // A manager runs the shop day to day: their own store's hours, radius and
  // proximity campaigns are part of that job.
  'locations:write',
  'wallet:write',
]

const ADMIN: Permission[] = [
  ...MANAGER,
  'customers:delete',
  'settings:write',
  'team:manage',
  'integrations:manage',
  'apikeys:manage',
  'audit:read',
]

const OWNER: Permission[] = [...ADMIN, 'billing:manage']

const VIEWER: Permission[] = [
  'customers:read',
  'programs:read',
  'campaigns:read',
  'analytics:read',
  'settings:read',
  'locations:read',
  'wallet:read',
]

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(OWNER),
  admin: new Set(ADMIN),
  manager: new Set(MANAGER),
  staff: new Set(STAFF),
  viewer: new Set(VIEWER),
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission)
}

export function permissionsForRole(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]]
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/** Ranking used to stop a member from escalating or editing a peer above them. */
const RANK: Record<Role, number> = { owner: 5, admin: 4, manager: 3, staff: 2, viewer: 1 }

export function outranks(actor: Role, target: Role): boolean {
  return RANK[actor] > RANK[target]
}

export function roleAtLeast(actor: Role, minimum: Role): boolean {
  return RANK[actor] >= RANK[minimum]
}
