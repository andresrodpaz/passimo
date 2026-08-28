import { z } from 'zod'
import { defineRoute } from '@/lib/api/handler'
import { getDb } from '@/lib/db'
import { notFound, unprocessable } from '@/lib/errors'
import { recordAudit } from '@/lib/audit'
import { invalidateProgramConfig } from '@/lib/loyalty/engine'
import { capabilityReport } from '@/lib/env'

export const runtime = 'nodejs'

const paramsSchema = z.object({ id: z.string().uuid() })

export const GET = defineRoute(
  {
    name: 'businesses.get',
    auth: 'required',
    params: paramsSchema,
    businessIdFrom: { source: 'params', key: 'id' },
    permissions: ['settings:read'],
    rateLimit: 'dashboard',
  },
  async ({ business }) => {
    const admin = getDb()
    const [{ data: row }, { data: locations }, { data: team }] = await Promise.all([
      admin.from('businesses').select('*').eq('id', business.businessId).maybeSingle(),
      admin
        .from('locations')
        .select('*')
        .eq('business_id', business.businessId)
        .is('archived_at', null)
        .order('is_default', { ascending: false }),
      admin
        .from('team_members')
        .select('id, user_id, role, status, display_name, invited_email, last_active_at, created_at')
        .eq('business_id', business.businessId)
        .order('created_at'),
    ])

    if (!row) throw notFound('Business')

    // Never return secret-bearing columns to the client.
    const safe = { ...row }
    for (const secret of ['stripe_customer_id', 'stripe_subscription_id']) {
      delete safe[secret]
    }

    return {
      business: safe,
      locations: locations ?? [],
      team: team ?? [],
      role: business.role,
      permissions: [...business.permissions],
      capabilities: capabilityReport(),
    }
  }
)

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  category: z.string().max(60).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  country: z.string().max(60).nullable().optional(),
  address: z.string().max(200).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  supportEmail: z.string().email().nullable().optional(),
  website: z.string().url().max(300).nullable().optional(),
  instagram: z.string().max(120).nullable().optional(),
  googleReviewUrl: z.string().url().max(500).nullable().optional(),
  timezone: z.string().max(60).optional(),
  currency: z.string().length(3).optional(),
  locale: z.enum(['es', 'en']).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  font: z.string().max(60).optional(),
  logoUrl: z.string().url().max(600).nullable().optional(),
  coverUrl: z.string().url().max(600).nullable().optional(),
  settings: z
    .object({
      quiet_hours: z
        .object({
          start: z.string().regex(/^\d{2}:\d{2}$/),
          end: z.string().regex(/^\d{2}:\d{2}$/),
        })
        .optional(),
      weekly_message_cap: z.number().int().min(0).max(20).optional(),
    })
    .partial()
    .optional(),
  onboardingCompleted: z.boolean().optional(),
})

export const PATCH = defineRoute(
  {
    name: 'businesses.update',
    auth: 'required',
    params: paramsSchema,
    body: patchSchema,
    businessIdFrom: { source: 'params', key: 'id' },
    permissions: ['settings:write'],
    rateLimit: 'dashboard',
  },
  async ({ params, body, actor, business, request }) => {
    const admin = getDb()
    const map: Record<string, string> = {
      name: 'name',
      category: 'category',
      city: 'city',
      country: 'country',
      address: 'address',
      postalCode: 'postal_code',
      phone: 'phone',
      supportEmail: 'support_email',
      website: 'website',
      instagram: 'instagram',
      googleReviewUrl: 'google_review_url',
      timezone: 'timezone',
      currency: 'currency',
      locale: 'locale',
      primaryColor: 'primary_color',
      accentColor: 'accent_color',
      textColor: 'text_color',
      font: 'font',
      logoUrl: 'logo_url',
      coverUrl: 'cover_url',
    }

    const patch: Record<string, unknown> = {}
    for (const [key, column] of Object.entries(map)) {
      const value = (body as Record<string, unknown>)[key]
      if (value !== undefined) patch[column] = value
    }

    if (body.settings) {
      // Merge rather than replace: settings is a growing bag and a partial
      // update from one screen must not wipe another screen's preferences.
      const { data: current } = await admin
        .from('businesses')
        .select('settings')
        .eq('id', params.id)
        .maybeSingle()
      patch.settings = { ...((current?.settings as object) ?? {}), ...body.settings }
    }

    if (body.onboardingCompleted) patch.onboarding_completed_at = new Date().toISOString()
    if (Object.keys(patch).length === 0) throw unprocessable('Nothing to update')

    const { error } = await admin.from('businesses').update(patch).eq('id', params.id)
    if (error) throw unprocessable(error.message)

    invalidateProgramConfig(business.businessId)
    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'business.updated',
      resourceType: 'business',
      resourceId: params.id,
      summary: `Updated ${Object.keys(patch).join(', ')}`,
      request,
    })

    return { ok: true }
  }
)
