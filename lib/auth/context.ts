import 'server-only'
import { getDb } from '@/lib/db'
import { getSession, resolveSessionToken } from '@/lib/auth/session'
import { forbidden, unauthorized } from '@/lib/errors'
import { sha256 } from '@/lib/crypto'
import {
  ROLE_PERMISSIONS,
  isRole,
  roleHasPermission,
  type Permission,
  type Role,
} from '@/lib/auth/rbac'

/**
 * A single authenticated actor abstraction covering all three entry points:
 *
 *  - `user`     dashboard session (cookie) or mobile client (bearer JWT)
 *  - `api_key`  server-to-server integrations against the public REST API
 *  - `system`   internal cron/worker invocations
 *
 * Downstream code asks the actor for permissions rather than inspecting how it
 * authenticated, so a new entry point never needs a new authorisation branch.
 */
export type ActorKind = 'user' | 'api_key' | 'system'

export type Actor = {
  kind: ActorKind
  /** `app_users.id` for `user`, api key id for `api_key`, null for `system`. */
  id: string | null
  email: string | null
  /** Businesses an api_key is scoped to; null means "resolve per request". */
  scopedBusinessId: string | null
  apiKeyId: string | null
}

export type BusinessContext = {
  businessId: string
  role: Role
  permissions: ReadonlySet<Permission>
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const [scheme, ...rest] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer') return null
  const token = rest.join(' ').trim()
  return token || null
}

/**
 * The prefix new API keys are minted with.
 *
 * A visible prefix is what lets a secret scanner recognise one of ours in a
 * public repository, and what tells a developer at a glance whether the string
 * they are holding is a key or a JWT.
 */
export const API_KEY_PREFIX = 'psm_'

/**
 * Prefixes that route a bearer token to the API-key resolver.
 *
 * `fid_` predates the rename. Keys are stored as SHA-256 hashes, so the prefix
 * is a routing hint rather than a credential — but a key already pasted into a
 * merchant's integration cannot be rewritten by us, and dropping the old prefix
 * would send it to the JWT path and fail it as "invalid or expired" instead of
 * authenticating it.
 */
const API_KEY_PREFIXES = [API_KEY_PREFIX, 'fid_'] as const

export function isApiKeyToken(token: string): boolean {
  return API_KEY_PREFIXES.some((prefix) => token.startsWith(prefix))
}

/**
 * Resolves the caller, or throws `unauthorized`.
 *
 * Three entry points in priority order:
 *
 *   1. `Authorization: Bearer psm_…` — a server-to-server API key.
 *   2. `Authorization: Bearer <session token>` — a native/mobile client holding
 *      the same session token the cookie carries, so one session model covers
 *      both surfaces.
 *   3. The session cookie — the dashboard.
 */
export async function resolveActor(request: Request): Promise<Actor> {
  const token = bearerToken(request)

  if (token && isApiKeyToken(token)) {
    return resolveApiKeyActor(token)
  }

  if (token) {
    const session = await resolveSessionToken(token)
    if (!session) throw unauthorized('Invalid or expired access token')
    return {
      kind: 'user',
      id: session.user.id,
      email: session.user.email,
      scopedBusinessId: null,
      apiKeyId: null,
    }
  }

  const session = await getSession()
  if (!session) throw unauthorized()

  return {
    kind: 'user',
    id: session.user.id,
    email: session.user.email,
    scopedBusinessId: null,
    apiKeyId: null,
  }
}

async function resolveApiKeyActor(token: string): Promise<Actor> {
  const admin = getDb()
  const { data } = await admin
    .from('api_keys')
    .select('id, business_id, revoked_at, expires_at, scopes')
    .eq('key_hash', sha256(token))
    .maybeSingle()

  if (!data) throw unauthorized('Invalid API key')
  if (data.revoked_at) throw unauthorized('API key has been revoked')
  if (data.expires_at && new Date(data.expires_at as string) < new Date()) {
    throw unauthorized('API key has expired')
  }

  // Fire-and-forget usage stamp; never blocks the request.
  void admin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => undefined)

  return {
    kind: 'api_key',
    id: data.id as string,
    email: null,
    scopedBusinessId: data.business_id as string,
    apiKeyId: data.id as string,
  }
}

const roleCache = new Map<string, { role: Role; expiresAt: number }>()
const ROLE_CACHE_TTL_MS = 15_000

/**
 * Resolves the actor's role on a business, throwing `forbidden` when they have
 * none. Short-TTL memoised because every authorised request needs it and role
 * changes are rare; 15s bounds the blast radius of a stale grant.
 */
export async function requireBusinessAccess(
  actor: Actor,
  businessId: string
): Promise<BusinessContext> {
  if (actor.kind === 'system') {
    return { businessId, role: 'owner', permissions: allPermissions() }
  }

  if (actor.kind === 'api_key') {
    if (actor.scopedBusinessId !== businessId) {
      throw forbidden('This API key is not scoped to that business')
    }
    return { businessId, role: 'admin', permissions: permissionSet('admin') }
  }

  if (!actor.id) throw unauthorized()

  const cacheKey = `${actor.id}:${businessId}`
  const cached = roleCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return { businessId, role: cached.role, permissions: permissionSet(cached.role) }
  }

  const admin = getDb()
  const { data } = await admin
    .from('team_members')
    .select('role, status')
    .eq('business_id', businessId)
    .eq('user_id', actor.id)
    .maybeSingle()

  if (!data || data.status !== 'active' || !isRole(data.role)) {
    throw forbidden('You do not have access to this business')
  }

  const role = data.role
  roleCache.set(cacheKey, { role, expiresAt: Date.now() + ROLE_CACHE_TTL_MS })
  return { businessId, role, permissions: permissionSet(role) }
}

export function requirePermission(context: BusinessContext, permission: Permission): void {
  if (!context.permissions.has(permission)) {
    throw forbidden(`Your role (${context.role}) cannot perform this action`)
  }
}

/** Invalidate after a role change so the actor sees it immediately. */
export function invalidateRoleCache(userId: string, businessId?: string): void {
  if (businessId) {
    roleCache.delete(`${userId}:${businessId}`)
    return
  }
  for (const key of roleCache.keys()) {
    if (key.startsWith(`${userId}:`)) roleCache.delete(key)
  }
}

function permissionSet(role: Role): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS[role]
}

function allPermissions(): ReadonlySet<Permission> {
  return ROLE_PERMISSIONS.owner
}

export { roleHasPermission }

/**
 * The businesses this actor can act on, newest first. Used to pick a default
 * workspace and to render the business switcher.
 */
export async function listActorBusinesses(actor: Actor) {
  if (actor.kind === 'api_key' && actor.scopedBusinessId) {
    const admin = getDb()
    const { data } = await admin
      .from('businesses')
      .select('id, name, slug, logo_url, plan')
      .eq('id', actor.scopedBusinessId)
    return (data ?? []).map((b) => ({ ...b, role: 'admin' as Role }))
  }

  if (!actor.id) return []
  const admin = getDb()
  const { data } = await admin
    .from('team_members')
    .select('role, businesses:business_id (id, name, slug, logo_url, plan)')
    .eq('user_id', actor.id)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  return (data ?? [])
    .map((row) => {
      const business = row.businesses as unknown as {
        id: string
        name: string
        slug: string
        logo_url: string | null
        plan: string | null
      } | null
      if (!business) return null
      return { ...business, role: (isRole(row.role) ? row.role : 'viewer') as Role }
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
}
