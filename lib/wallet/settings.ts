import 'server-only'
import { getDb } from '@/lib/db'
import { logger } from '@/lib/logger'
import { num } from '@/lib/domain/types'
import { findTemplate } from '@/lib/wallet/templates'
import type { WalletSettings } from '@/lib/wallet/types'

/**
 * Merchant wallet configuration.
 *
 * The product rule this file enforces: *nothing about wallet behaviour lives in
 * the environment*. Radiuses, triggers, quiet hours, notification copy, which
 * suggestions are on — all of it is tenant data a merchant edits in the
 * dashboard, and all of it is read from here.
 *
 * A business always has settings. `DEFAULT_SETTINGS` is returned when the row is
 * missing rather than null, so no caller — and no UI — ever has to handle an
 * "unconfigured" state. The defaults are also the defaults a new business is
 * created with, so "what happens before the merchant touches anything" is
 * defined exactly once.
 */

export const DEFAULT_WALLET_SETTINGS: Omit<WalletSettings, 'businessId'> = {
  proximityEnabled: true,
  geofencingEnabled: true,
  beaconsEnabled: false,

  appleLockScreenSuggestions: true,
  googleWalletSuggestions: true,
  nearbyRecommendations: true,
  automaticPassUpdates: true,
  dynamicPassContent: true,
  rewardNotifications: true,
  loyaltyReminders: true,
  maxRelevantLocations: 10,

  defaultRadiusMeters: 200,
  defaultDwellMinutes: 5,
  /*
   * Two a day, six hours apart. Chosen from the failure mode rather than from
   * ambition: a wallet pass is deleted the first time it feels like spam, and a
   * deleted pass is unrecoverable — there is no re-permission flow. A merchant
   * can raise these, but the default should never be the reason they lose a card.
   */
  maxNotificationsPerDay: 2,
  minHoursBetweenNotifications: 6,

  quietHoursStart: 22,
  quietHoursEnd: 8,
  respectQuietHours: true,

  branding: {
    emoji: null,
    title: null,
    message: null,
    cta: null,
    brandColor: null,
    brandTextColor: null,
    logoUrl: null,
    heroImageUrl: null,
  },
  passExpirationDays: null,

  appliedTemplate: null,
  appliedTemplateAt: null,
}

type SettingsRow = Record<string, unknown>

export function mapWalletSettings(businessId: string, row: SettingsRow | null): WalletSettings {
  if (!row) return { businessId, ...DEFAULT_WALLET_SETTINGS }

  const flag = (key: string, fallback: boolean): boolean =>
    typeof row[key] === 'boolean' ? (row[key] as boolean) : fallback

  return {
    businessId,
    proximityEnabled: flag('proximity_enabled', true),
    geofencingEnabled: flag('geofencing_enabled', true),
    beaconsEnabled: flag('beacons_enabled', false),

    appleLockScreenSuggestions: flag('apple_lock_screen_suggestions', true),
    googleWalletSuggestions: flag('google_wallet_suggestions', true),
    nearbyRecommendations: flag('nearby_recommendations', true),
    automaticPassUpdates: flag('automatic_pass_updates', true),
    dynamicPassContent: flag('dynamic_pass_content', true),
    rewardNotifications: flag('reward_notifications', true),
    loyaltyReminders: flag('loyalty_reminders', true),
    maxRelevantLocations: num(row.max_relevant_locations, 10),

    defaultRadiusMeters: num(row.default_radius_m, 200),
    defaultDwellMinutes: num(row.default_dwell_minutes, 5),
    maxNotificationsPerDay: num(row.max_notifications_per_day, 2),
    minHoursBetweenNotifications: num(row.min_hours_between_notifications, 6),

    quietHoursStart: num(row.quiet_hours_start, 22),
    quietHoursEnd: num(row.quiet_hours_end, 8),
    respectQuietHours: flag('respect_quiet_hours', true),

    branding: {
      emoji: (row.notification_emoji as string) ?? null,
      title: (row.notification_title as string) ?? null,
      message: (row.notification_message as string) ?? null,
      cta: (row.notification_cta as string) ?? null,
      brandColor: (row.brand_color as string) ?? null,
      brandTextColor: (row.brand_text_color as string) ?? null,
      logoUrl: (row.logo_url as string) ?? null,
      heroImageUrl: (row.hero_image_url as string) ?? null,
    },
    passExpirationDays:
      row.pass_expiration_days === null || row.pass_expiration_days === undefined
        ? null
        : num(row.pass_expiration_days),

    appliedTemplate: (row.applied_template as string) ?? null,
    appliedTemplateAt: (row.applied_template_at as string) ?? null,
  }
}

export async function getWalletSettings(businessId: string): Promise<WalletSettings> {
  const admin = getDb()
  const { data, error } = await admin
    .from('wallet_settings')
    .select('*')
    .eq('business_id', businessId)
    .maybeSingle()

  if (error) {
    // Proximity is an enhancement layered on a card that works without it.
    // Failing a pass download because a settings read failed would break the
    // core product to protect an optional one.
    logger.warn('wallet.settings_read_failed', { business_id: businessId, error })
    return { businessId, ...DEFAULT_WALLET_SETTINGS }
  }

  return mapWalletSettings(businessId, data)
}

/** Creates the defaults row for a business that does not have one yet. */
export async function ensureWalletSettings(businessId: string): Promise<WalletSettings> {
  const admin = getDb()
  await admin.from('wallet_settings').upsert({ business_id: businessId }, { onConflict: 'business_id' })
  return getWalletSettings(businessId)
}

/** The API-facing patch shape. Every field optional; only what is sent changes. */
export type WalletSettingsPatch = {
  proximityEnabled?: boolean
  geofencingEnabled?: boolean
  beaconsEnabled?: boolean
  appleLockScreenSuggestions?: boolean
  googleWalletSuggestions?: boolean
  nearbyRecommendations?: boolean
  automaticPassUpdates?: boolean
  dynamicPassContent?: boolean
  rewardNotifications?: boolean
  loyaltyReminders?: boolean
  maxRelevantLocations?: number
  defaultRadiusMeters?: number
  defaultDwellMinutes?: number
  maxNotificationsPerDay?: number
  minHoursBetweenNotifications?: number
  quietHoursStart?: number
  quietHoursEnd?: number
  respectQuietHours?: boolean
  notificationEmoji?: string | null
  notificationTitle?: string | null
  notificationMessage?: string | null
  notificationCta?: string | null
  brandColor?: string | null
  brandTextColor?: string | null
  logoUrl?: string | null
  heroImageUrl?: string | null
  passExpirationDays?: number | null
}

const COLUMN_BY_FIELD: Record<keyof WalletSettingsPatch, string> = {
  proximityEnabled: 'proximity_enabled',
  geofencingEnabled: 'geofencing_enabled',
  beaconsEnabled: 'beacons_enabled',
  appleLockScreenSuggestions: 'apple_lock_screen_suggestions',
  googleWalletSuggestions: 'google_wallet_suggestions',
  nearbyRecommendations: 'nearby_recommendations',
  automaticPassUpdates: 'automatic_pass_updates',
  dynamicPassContent: 'dynamic_pass_content',
  rewardNotifications: 'reward_notifications',
  loyaltyReminders: 'loyalty_reminders',
  maxRelevantLocations: 'max_relevant_locations',
  defaultRadiusMeters: 'default_radius_m',
  defaultDwellMinutes: 'default_dwell_minutes',
  maxNotificationsPerDay: 'max_notifications_per_day',
  minHoursBetweenNotifications: 'min_hours_between_notifications',
  quietHoursStart: 'quiet_hours_start',
  quietHoursEnd: 'quiet_hours_end',
  respectQuietHours: 'respect_quiet_hours',
  notificationEmoji: 'notification_emoji',
  notificationTitle: 'notification_title',
  notificationMessage: 'notification_message',
  notificationCta: 'notification_cta',
  brandColor: 'brand_color',
  brandTextColor: 'brand_text_color',
  logoUrl: 'logo_url',
  heroImageUrl: 'hero_image_url',
  passExpirationDays: 'pass_expiration_days',
}

export async function updateWalletSettings(
  businessId: string,
  patch: WalletSettingsPatch
): Promise<WalletSettings> {
  const update: Record<string, unknown> = { business_id: businessId }
  for (const [field, column] of Object.entries(COLUMN_BY_FIELD)) {
    const value = patch[field as keyof WalletSettingsPatch]
    if (value !== undefined) update[column] = value
  }

  const admin = getDb()
  const { error } = await admin
    .from('wallet_settings')
    .upsert(update, { onConflict: 'business_id' })

  if (error) throw error
  return getWalletSettings(businessId)
}

/**
 * Applies an industry template's settings block.
 *
 * Only the settings; campaigns and rules are created by
 * `lib/wallet/campaigns.ts` and `lib/wallet/rule-store.ts` so that each layer
 * owns its own writes and the operation can be reported per part.
 */
export async function applyTemplateSettings(
  businessId: string,
  templateKey: string
): Promise<WalletSettings | null> {
  const template = findTemplate(templateKey)
  if (!template) return null

  const admin = getDb()
  const { error } = await admin.from('wallet_settings').upsert(
    {
      business_id: businessId,
      default_radius_m: template.settings.defaultRadiusMeters,
      default_dwell_minutes: template.settings.defaultDwellMinutes,
      max_notifications_per_day: template.settings.maxNotificationsPerDay,
      min_hours_between_notifications: template.settings.minHoursBetweenNotifications,
      quiet_hours_start: template.settings.quietHoursStart,
      quiet_hours_end: template.settings.quietHoursEnd,
      reward_notifications: template.settings.rewardNotifications,
      loyalty_reminders: template.settings.loyaltyReminders,
      nearby_recommendations: template.settings.nearbyRecommendations,
      notification_emoji: template.settings.notificationEmoji,
      applied_template: template.key,
      applied_template_at: new Date().toISOString(),
    },
    { onConflict: 'business_id' }
  )

  if (error) throw error
  return getWalletSettings(businessId)
}
