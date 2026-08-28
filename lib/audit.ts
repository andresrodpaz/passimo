import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { clientIp } from '@/lib/rate-limit'
import type { Actor } from '@/lib/auth/context'

/**
 * Audit trail.
 *
 * Records who changed what. Required for GDPR art. 30 records of processing,
 * useful for support ("who deleted that customer?"), and the thing enterprise
 * buyers ask about first. Never throws: an audit failure must not roll back a
 * legitimate business action, but it is logged loudly.
 */

/** Any actor shape works: routes pass the resolved `Actor`, background jobs
 *  and public flows pass a minimal descriptor. */
export type AuditActor =
  | Actor
  | { kind: 'user' | 'customer' | 'system' | 'api_key'; id?: string | null; email?: string | null }

export type AuditEntry = {
  businessId: string | null
  actor: AuditActor
  action: string
  resourceType?: string
  resourceId?: string | null
  summary?: string
  metadata?: Record<string, unknown>
  request?: Request
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = getDb()
    await admin.from('audit_log').insert({
      business_id: entry.businessId,
      actor_type: entry.actor.kind,
      actor_id: entry.actor.id ?? null,
      actor_email: entry.actor.email ?? null,
      action: entry.action,
      resource_type: entry.resourceType ?? null,
      resource_id: entry.resourceId ?? null,
      summary: entry.summary ?? null,
      metadata: entry.metadata ?? {},
      ip: entry.request ? nullableIp(clientIp(entry.request)) : null,
      user_agent: entry.request?.headers.get('user-agent') ?? null,
    })
  } catch (cause) {
    logger.error('audit.write_failed', { action: entry.action, cause })
  }
}

function nullableIp(value: string): string | null {
  return value && value !== 'unknown' ? value : null
}
