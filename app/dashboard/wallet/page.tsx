'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  BarChart3,
  Bell,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Palette,
  Radio,
  Sparkles,
  Store,
  Wand2,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErrorState, LoadingCards } from '@/components/states'
import { UpgradePrompt } from '@/components/billing/upgrade'
import { apiPatch, apiPost, useApi, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { useI18n } from '@/lib/i18n'
import type { ProviderStatus, WalletSettings } from '@/lib/wallet/types'
import { WalletCampaignsPanel } from '@/components/wallet/campaigns-panel'
import { WalletRulesPanel } from '@/components/wallet/rules-panel'
import { WalletAnalyticsPanel } from '@/components/wallet/analytics-panel'
import { CardDesignPanel } from '@/components/wallet/design-panel'
import { BrandKitPanel } from '@/components/brand/brand-kit-panel'

/**
 * Wallet & proximity.
 *
 * The screen the whole proximity feature is configured from, and the one that has to
 * make good on the product principle: *a merchant never edits code, never changes an
 * environment variable, and never contacts support to change wallet behaviour.*
 *
 * Two things it does that a settings screen usually does not:
 *
 *   * **It tells the truth about the deployment.** Provider status, including the
 *     exact missing environment variable, is rendered at the top. A merchant whose
 *     Apple certificate has not been installed sees why their cards do not issue,
 *     rather than a page of toggles that silently do nothing — which is the state a
 *     pre-credentials deployment is genuinely in.
 *
 *   * **It separates identity, appearance and behaviour**, because merchants think
 *     about them separately and mixing them is what makes loyalty dashboards
 *     unusable:
 *
 *       BRAND      who the business is — logo, colours, contact, social
 *       DESIGN     how the card looks — template, layout, what it shows
 *       BEHAVIOUR  when the card notifies — radius, dwell, quiet hours, caps
 *
 *     Those are three tabs, in that order, and the first two are first because
 *     they are what a merchant came here to do. A restaurant owner should be able
 *     to tell which tab they want without reading any of them.
 *
 * What this screen used to do, and no longer does: it carried "Card background"
 * and "Card text" colour pickers writing `wallet_settings.brand_color`, above a
 * card preview driven by those same two values — and since migration 21 nothing
 * reads that column when building a pass. A merchant could pick a colour, watch
 * a card change, press Save, and ship exactly nothing. Those controls are gone;
 * the card face is the Design tab's job, and what stays here is the lock-screen
 * notification, which is genuinely what this tab configures.
 */

type SettingsResponse = {
  settings: WalletSettings
  providers: ProviderStatus[]
  entitlements: {
    geofencing: boolean
    proximity_campaigns: boolean
    automation_rules: boolean
  }
  locations: Array<{
    id: string
    name: string
    city: string | null
    isDefault: boolean
    isVisible: boolean
    hasCoordinates: boolean
    geofence: { enabled: boolean; notificationRadiusMeters: number }
  }>
  templates: Array<{
    key: string
    name: string
    summary: string
    emoji: string
    campaigns: number
    rules: number
  }>
}

export default function WalletPage() {
  const { t } = useI18n()
  const { businessId, can, capabilities } = useWorkspace()

  const { data, error, isLoading, mutate } = useApi<SettingsResponse>(
    businessId ? `/api/v1/wallet/settings${query({ businessId })}` : null
  )

  const canWrite = can('wallet:write')
  const canEditBrand = can('settings:write')
  const uploadsEnabled = capabilities?.storage ?? false

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('wallet.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('wallet.subtitle')}</p>
      </header>

      {isLoading && <LoadingCards count={2} />}
      {error && <ErrorState error={error} onRetry={() => void mutate()} />}

      {data && businessId && (
        <>
          <ProviderStatusPanel providers={data.providers} />

          <Tabs defaultValue="design">
            <TabsList className="w-full justify-start overflow-x-auto">
              {/* Design and Brand come first because they are what a merchant
                  opens this screen to do. Behaviour is tuning; appearance is
                  the product. */}
              <TabsTrigger value="design" className="gap-1.5">
                <Palette className="size-3.5" aria-hidden />
                {t('wallet.tabs.design')}
              </TabsTrigger>
              <TabsTrigger value="brand" className="gap-1.5">
                <Store className="size-3.5" aria-hidden />
                {t('wallet.tabs.brand')}
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-1.5">
                <Radio className="size-3.5" aria-hidden />
                {t('wallet.tabs.behaviour')}
              </TabsTrigger>
              <TabsTrigger value="campaigns" className="gap-1.5">
                <Bell className="size-3.5" aria-hidden />
                {t('wallet.tabs.campaigns')}
              </TabsTrigger>
              <TabsTrigger value="rules" className="gap-1.5">
                <Zap className="size-3.5" aria-hidden />
                {t('wallet.tabs.rules')}
              </TabsTrigger>
              <TabsTrigger value="analytics" className="gap-1.5">
                <BarChart3 className="size-3.5" aria-hidden />
                {t('wallet.tabs.analytics')}
              </TabsTrigger>
              <TabsTrigger value="templates" className="gap-1.5">
                <Wand2 className="size-3.5" aria-hidden />
                {t('wallet.tabs.templates')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="design" className="mt-6">
              <CardDesignPanel
                businessId={businessId}
                canWrite={canWrite}
                uploadsEnabled={uploadsEnabled}
              />
            </TabsContent>

            <TabsContent value="brand" className="mt-6">
              <BrandKitPanel businessId={businessId} canWrite={canEditBrand} />
            </TabsContent>

            <TabsContent value="settings" className="mt-6">
              <SettingsPanel
                /*
                 * Remounting is how React resets state when identity changes; the
                 * alternative — comparing a ref during render — is the pattern React
                 * explicitly warns against, and it silently skips the reset when two
                 * templates are applied in the same tick.
                 */
                key={data.settings.appliedTemplateAt ?? 'base'}
                businessId={businessId}
                data={data}
                canWrite={canWrite}
                onSaved={() => void mutate()}
              />
            </TabsContent>

            <TabsContent value="campaigns" className="mt-6">
              {data.entitlements.proximity_campaigns ? (
                <WalletCampaignsPanel businessId={businessId} canWrite={canWrite} />
              ) : (
                <UpgradePrompt feature="proximity_campaigns" />
              )}
            </TabsContent>

            <TabsContent value="rules" className="mt-6">
              {data.entitlements.automation_rules ? (
                <WalletRulesPanel businessId={businessId} canWrite={canWrite} />
              ) : (
                <UpgradePrompt feature="automation_rules" />
              )}
            </TabsContent>

            <TabsContent value="analytics" className="mt-6">
              <WalletAnalyticsPanel businessId={businessId} />
            </TabsContent>

            <TabsContent value="templates" className="mt-6">
              <TemplatesPanel
                businessId={businessId}
                templates={data.templates}
                current={data.settings.appliedTemplate}
                canWrite={canWrite}
                onApplied={() => void mutate()}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Provider status
// -----------------------------------------------------------------------------

function ProviderStatusPanel({ providers }: { providers: ProviderStatus[] }) {
  const { t } = useI18n()
  const anyUnconfigured = providers.some((provider) => !provider.configured)

  return (
    <section className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {providers.map((provider) => (
          <div
            key={provider.id}
            className="rounded-2xl border bg-card p-4"
            aria-labelledby={`provider-${provider.id}`}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id={`provider-${provider.id}`} className="text-sm font-semibold">
                {provider.label}
              </h2>
              <Badge
                variant={provider.configured ? 'secondary' : 'outline'}
                className="shrink-0 gap-1.5"
              >
                {provider.configured ? (
                  <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden />
                ) : (
                  <AlertTriangle className="size-3 text-amber-500" aria-hidden />
                )}
                {provider.configured
                  ? t('wallet.providers.configured')
                  : t('wallet.providers.notConfigured')}
              </Badge>
            </div>

            {provider.missing.length > 0 && (
              <p className="mt-2 break-words font-mono text-xs text-muted-foreground">
                {t('wallet.providers.missing', { vars: provider.missing.join(', ') })}
              </p>
            )}

            <ul className="mt-3 flex flex-wrap gap-1.5">
              {provider.supports.geofencedRelevance && (
                <Capability label={t('wallet.providers.supportsGeofence')} />
              )}
              {provider.supports.lockScreenSuggestions && (
                <Capability label={t('wallet.providers.supportsLockScreen')} />
              )}
              {provider.supports.beacons && (
                <Capability label={t('wallet.providers.supportsBeacons')} />
              )}
              {provider.supports.pushUpdates && (
                <Capability label={t('wallet.providers.supportsPush')} />
              )}
              {provider.supports.richNotifications && (
                <Capability label={t('wallet.providers.supportsRich')} />
              )}
            </ul>
          </div>
        ))}
      </div>

      {anyUnconfigured && (
        <Alert>
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>{t('wallet.providers.notConfigured')}</AlertTitle>
          <AlertDescription>{t('wallet.providers.notConfiguredBody')}</AlertDescription>
        </Alert>
      )}
    </section>
  )
}

function Capability({ label }: { label: string }) {
  return (
    <li>
      <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
        {label}
      </span>
    </li>
  )
}

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

function SettingsPanel({
  businessId,
  data,
  canWrite,
  onSaved,
}: {
  businessId: string
  data: SettingsResponse
  canWrite: boolean
  onSaved: () => void
}) {
  const { t } = useI18n()
  // Seeded once. The parent remounts this panel when the server sends a materially
  // different settings row, so there is no in-place re-seeding to get wrong.
  const [draft, setDraft] = React.useState<WalletSettings>(data.settings)
  const [saving, setSaving] = React.useState(false)

  const set = <K extends keyof WalletSettings>(key: K, value: WalletSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const setBranding = <K extends keyof WalletSettings['branding']>(
    key: K,
    value: WalletSettings['branding'][K]
  ) => setDraft((current) => ({ ...current, branding: { ...current.branding, [key]: value } }))

  async function save() {
    setSaving(true)
    try {
      await apiPatch('/api/v1/wallet/settings', {
        businessId,
        proximityEnabled: draft.proximityEnabled,
        geofencingEnabled: draft.geofencingEnabled,
        beaconsEnabled: draft.beaconsEnabled,
        appleLockScreenSuggestions: draft.appleLockScreenSuggestions,
        googleWalletSuggestions: draft.googleWalletSuggestions,
        nearbyRecommendations: draft.nearbyRecommendations,
        automaticPassUpdates: draft.automaticPassUpdates,
        dynamicPassContent: draft.dynamicPassContent,
        rewardNotifications: draft.rewardNotifications,
        loyaltyReminders: draft.loyaltyReminders,
        maxRelevantLocations: draft.maxRelevantLocations,
        defaultRadiusMeters: draft.defaultRadiusMeters,
        defaultDwellMinutes: draft.defaultDwellMinutes,
        maxNotificationsPerDay: draft.maxNotificationsPerDay,
        minHoursBetweenNotifications: draft.minHoursBetweenNotifications,
        quietHoursStart: draft.quietHoursStart,
        quietHoursEnd: draft.quietHoursEnd,
        respectQuietHours: draft.respectQuietHours,
        notificationEmoji: draft.branding.emoji,
        notificationTitle: draft.branding.title,
        notificationMessage: draft.branding.message,
        notificationCta: draft.branding.cta,
        passExpirationDays: draft.passExpirationDays,
      })
      toast.success(t('common.saved'))
      onSaved()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('common.somethingWentWrong'))
    } finally {
      setSaving(false)
    }
  }

  const locationsWithoutCoordinates = data.locations.filter(
    (location) => location.isVisible && !location.hasCoordinates
  )

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
      <div className="space-y-6">
        {/* A proximity setting is meaningless without a coordinate, so the gap is
            surfaced here with the fix one click away — not left for the merchant to
            infer from silence. */}
        {locationsWithoutCoordinates.length > 0 && (
          <Alert>
            <MapPin className="size-4" aria-hidden />
            <AlertTitle>{t('locations.geofence.noCoordinates')}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              {locationsWithoutCoordinates.map((location) => location.name).join(', ')}
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                <Link href="/dashboard/locations">{t('locations.title')}</Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Panel title={t('wallet.masterSwitches.title')}>
          <ToggleRow
            id="proximity-enabled"
            label={t('wallet.masterSwitches.proximityEnabled')}
            help={t('wallet.masterSwitches.proximityEnabledHelp')}
            checked={draft.proximityEnabled}
            disabled={!canWrite}
            onChange={(value) => set('proximityEnabled', value)}
          />
          <ToggleRow
            id="geofencing-enabled"
            label={t('wallet.masterSwitches.geofencingEnabled')}
            help={t('wallet.masterSwitches.geofencingEnabledHelp')}
            checked={draft.geofencingEnabled}
            disabled={!canWrite || !draft.proximityEnabled || !data.entitlements.geofencing}
            locked={!data.entitlements.geofencing}
            onChange={(value) => set('geofencingEnabled', value)}
          />
          <ToggleRow
            id="beacons-enabled"
            label={t('wallet.masterSwitches.beaconsEnabled')}
            help={t('wallet.masterSwitches.beaconsEnabledHelp')}
            checked={draft.beaconsEnabled}
            disabled={!canWrite || !draft.proximityEnabled}
            onChange={(value) => set('beaconsEnabled', value)}
          />
        </Panel>

        <Panel
          title={t('wallet.suggestions.title')}
          description={t('wallet.suggestions.subtitle')}
        >
          <ToggleRow
            id="apple-lock"
            label={t('wallet.suggestions.appleLockScreen')}
            help={t('wallet.suggestions.appleLockScreenHelp')}
            checked={draft.appleLockScreenSuggestions}
            disabled={!canWrite || !draft.proximityEnabled}
            onChange={(value) => set('appleLockScreenSuggestions', value)}
          />
          <ToggleRow
            id="google-suggestions"
            label={t('wallet.suggestions.googleSuggestions')}
            help={t('wallet.suggestions.googleSuggestionsHelp')}
            checked={draft.googleWalletSuggestions}
            disabled={!canWrite || !draft.proximityEnabled}
            onChange={(value) => set('googleWalletSuggestions', value)}
          />
          <ToggleRow
            id="nearby-recommendations"
            label={t('wallet.suggestions.nearbyRecommendations')}
            help={t('wallet.suggestions.nearbyRecommendationsHelp')}
            checked={draft.nearbyRecommendations}
            disabled={!canWrite}
            onChange={(value) => set('nearbyRecommendations', value)}
          />
          <ToggleRow
            id="automatic-updates"
            label={t('wallet.suggestions.automaticUpdates')}
            help={t('wallet.suggestions.automaticUpdatesHelp')}
            checked={draft.automaticPassUpdates}
            disabled={!canWrite}
            onChange={(value) => set('automaticPassUpdates', value)}
          />
          <ToggleRow
            id="dynamic-content"
            label={t('wallet.suggestions.dynamicContent')}
            help={t('wallet.suggestions.dynamicContentHelp')}
            checked={draft.dynamicPassContent}
            disabled={!canWrite}
            onChange={(value) => set('dynamicPassContent', value)}
          />
          <ToggleRow
            id="reward-notifications"
            label={t('wallet.suggestions.rewardNotifications')}
            help={t('wallet.suggestions.rewardNotificationsHelp')}
            checked={draft.rewardNotifications}
            disabled={!canWrite}
            onChange={(value) => set('rewardNotifications', value)}
          />
          <ToggleRow
            id="loyalty-reminders"
            label={t('wallet.suggestions.loyaltyReminders')}
            help={t('wallet.suggestions.loyaltyRemindersHelp')}
            checked={draft.loyaltyReminders}
            disabled={!canWrite}
            onChange={(value) => set('loyaltyReminders', value)}
          />

          <Separator className="my-2" />

          <NumberRow
            id="max-relevant"
            label={t('wallet.suggestions.maxRelevantLocations')}
            help={t('wallet.suggestions.maxRelevantLocationsHelp')}
            value={draft.maxRelevantLocations}
            min={1}
            max={10}
            disabled={!canWrite}
            onChange={(value) => set('maxRelevantLocations', value)}
          />
        </Panel>

        <Panel title={t('wallet.frequency.title')} description={t('wallet.frequency.subtitle')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberRow
              id="default-radius"
              label={t('wallet.frequency.defaultRadius')}
              help={t('wallet.frequency.defaultRadiusHelp')}
              value={draft.defaultRadiusMeters}
              min={50}
              max={50_000}
              suffix="m"
              disabled={!canWrite}
              onChange={(value) => set('defaultRadiusMeters', value)}
            />
            <NumberRow
              id="default-dwell"
              label={t('wallet.frequency.defaultDwell')}
              value={draft.defaultDwellMinutes}
              min={1}
              max={720}
              suffix="min"
              disabled={!canWrite}
              onChange={(value) => set('defaultDwellMinutes', value)}
            />
            <NumberRow
              id="max-per-day"
              label={t('wallet.frequency.maxPerDay')}
              value={draft.maxNotificationsPerDay}
              min={0}
              max={20}
              disabled={!canWrite}
              onChange={(value) => set('maxNotificationsPerDay', value)}
            />
            <NumberRow
              id="min-gap"
              label={t('wallet.frequency.minHoursBetween')}
              value={draft.minHoursBetweenNotifications}
              min={0}
              max={168}
              suffix="h"
              disabled={!canWrite}
              onChange={(value) => set('minHoursBetweenNotifications', value)}
            />
          </div>

          <Separator className="my-2" />

          <ToggleRow
            id="quiet-hours"
            label={t('wallet.frequency.respectQuietHours')}
            help={t('wallet.frequency.quietHoursHelp')}
            checked={draft.respectQuietHours}
            disabled={!canWrite}
            onChange={(value) => set('respectQuietHours', value)}
          />

          {draft.respectQuietHours && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="quiet-from" className="text-sm">
                  {t('wallet.frequency.quietFrom')}
                </Label>
                <HourSelect
                  id="quiet-from"
                  value={draft.quietHoursStart}
                  disabled={!canWrite}
                  onChange={(value) => set('quietHoursStart', value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quiet-until" className="text-sm">
                  {t('wallet.frequency.quietUntil')}
                </Label>
                <HourSelect
                  id="quiet-until"
                  value={draft.quietHoursEnd}
                  disabled={!canWrite}
                  onChange={(value) => set('quietHoursEnd', value)}
                />
              </div>
            </div>
          )}
        </Panel>

        <Panel title={t('wallet.branding.title')} description={t('wallet.branding.subtitle')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextRow
              id="brand-emoji"
              label={t('wallet.branding.emoji')}
              value={draft.branding.emoji ?? ''}
              maxLength={8}
              disabled={!canWrite}
              onChange={(value) => setBranding('emoji', value || null)}
            />
            <TextRow
              id="brand-cta"
              label={t('wallet.branding.cta')}
              value={draft.branding.cta ?? ''}
              maxLength={40}
              disabled={!canWrite}
              onChange={(value) => setBranding('cta', value || null)}
            />
          </div>

          <TextRow
            id="brand-title"
            label={t('wallet.branding.notificationTitle')}
            value={draft.branding.title ?? ''}
            maxLength={60}
            disabled={!canWrite}
            onChange={(value) => setBranding('title', value || null)}
          />
          <TextRow
            id="brand-message"
            label={t('wallet.branding.notificationMessage')}
            value={draft.branding.message ?? ''}
            maxLength={300}
            disabled={!canWrite}
            onChange={(value) => setBranding('message', value || null)}
          />

          {/* The card's own colours are not here. They belong to the brand kit
              and the card design, which the first two tabs own — this panel is
              about the notification, and duplicating the colour pickers is what
              created two answers to one question in the first place. */}
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            {t('wallet.branding.colorsMovedNote')}
          </p>

          <NumberRow
            id="pass-expiration"
            label={t('wallet.branding.passExpiration')}
            help={t('wallet.branding.passExpirationHelp')}
            value={draft.passExpirationDays ?? 0}
            min={0}
            max={3_650}
            suffix="d"
            disabled={!canWrite}
            onChange={(value) => set('passExpirationDays', value === 0 ? null : value)}
          />
        </Panel>

        {canWrite && (
          <div className="sticky bottom-4 flex justify-end">
            <Button onClick={save} disabled={saving} size="lg" className="gap-2 shadow-lg">
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        )}
      </div>

      {/* Live preview.

          One preview, of the one thing this tab controls. It used to also show a
          loyalty card driven by two settings columns that no longer reach any
          pass — a preview of a change that did not happen. */}
      <aside className="space-y-4 xl:sticky xl:top-24">
        <div>
          <h2 className="text-sm font-semibold">{t('wallet.preview.lockScreen')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('wallet.preview.subtitle')}</p>
        </div>

        {/* The lock-screen notification, rendered from the merchant's own defaults —
            the single most important thing to get right, because it is what a
            customer actually sees. */}
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('wallet.preview.lockScreen')}
          </p>
          <div className="mt-3 rounded-xl bg-muted/60 p-3">
            <div className="flex items-start gap-2.5">
              {draft.branding.emoji && (
                <span aria-hidden className="text-lg leading-none">
                  {draft.branding.emoji}
                </span>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug">
                  {draft.branding.title || t('wallet.branding.notificationTitle')}
                </p>
                <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                  {draft.branding.message || t('wallet.branding.notificationMessage')}
                </p>
              </div>
            </div>
          </div>

          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3" aria-hidden />
            {draft.respectQuietHours
              ? `${String(draft.quietHoursStart).padStart(2, '0')}:00 – ${String(
                  draft.quietHoursEnd
                ).padStart(2, '0')}:00`
              : t('common.disabled')}
          </p>
        </div>
      </aside>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Templates
// -----------------------------------------------------------------------------

function TemplatesPanel({
  businessId,
  templates,
  current,
  canWrite,
  onApplied,
}: {
  businessId: string
  templates: SettingsResponse['templates']
  current: string | null
  canWrite: boolean
  onApplied: () => void
}) {
  const { t } = useI18n()
  const [applying, setApplying] = React.useState<string | null>(null)

  async function apply(key: string) {
    setApplying(key)
    try {
      const result = await apiPost<{ campaigns: { created: number }; rules: { created: number } }>(
        '/api/v1/wallet/templates',
        { businessId, templateKey: key }
      )
      toast.success(
        t('wallet.templates.appliedNote'),
        {
          description: [
            t('wallet.templates.includesCampaigns', { count: result.campaigns.created }),
            t('wallet.templates.includesRules', { count: result.rules.created }),
          ].join(' · '),
        }
      )
      onApplied()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('common.somethingWentWrong'))
    } finally {
      setApplying(null)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{t('wallet.templates.title')}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {t('wallet.templates.subtitle')}
        </p>
      </div>

      {current && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="size-4 text-primary" aria-hidden />
          {t('wallet.templates.currentTemplate', {
            name: templates.find((template) => template.key === current)?.name ?? current,
          })}
        </p>
      )}

      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {templates.map((template) => (
          <li key={template.key}>
            <article
              className={
                template.key === current
                  ? 'flex h-full flex-col rounded-2xl border-2 border-primary/50 bg-card p-5'
                  : 'flex h-full flex-col rounded-2xl border bg-card p-5 transition-shadow hover:shadow-md'
              }
            >
              <span aria-hidden className="text-2xl leading-none">
                {template.emoji}
              </span>
              <h3 className="mt-3 text-base font-semibold">{template.name}</h3>
              <p className="mt-1.5 flex-1 text-sm text-muted-foreground">{template.summary}</p>

              <p className="mt-4 text-xs text-muted-foreground">
                {t('wallet.templates.includes')}:{' '}
                {t('wallet.templates.includesCampaigns', { count: template.campaigns })} ·{' '}
                {t('wallet.templates.includesRules', { count: template.rules })}
              </p>

              {canWrite && (
                <Button
                  variant={template.key === current ? 'secondary' : 'outline'}
                  className="mt-4 w-full gap-2"
                  disabled={applying !== null}
                  onClick={() => apply(template.key)}
                >
                  {applying === template.key && (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  )}
                  {applying === template.key
                    ? t('wallet.templates.applying')
                    : template.key === current
                      ? t('wallet.templates.applied')
                      : t('wallet.templates.apply')}
                </Button>
              )}
            </article>
          </li>
        ))}
      </ul>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Form primitives
// -----------------------------------------------------------------------------

function Panel({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  )
}

function ToggleRow({
  id,
  label,
  help,
  checked,
  disabled,
  locked,
  onChange,
}: {
  id: string
  label: string
  help?: string
  checked: boolean
  disabled?: boolean
  locked?: boolean
  onChange: (checked: boolean) => void
}) {
  const { t } = useI18n()

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
          {label}
          {locked && (
            <Badge variant="outline" className="ml-2 text-[10px]">
              {t('common.upgradeRequired')}
            </Badge>
          )}
        </Label>
        {help && <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="mt-0.5 shrink-0"
      />
    </div>
  )
}

function NumberRow({
  id,
  label,
  help,
  value,
  min,
  max,
  suffix,
  disabled,
  onChange,
}: {
  id: string
  label: string
  help?: string
  value: number
  min: number
  max: number
  suffix?: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <div className="relative max-w-40">
        <Input
          id={id}
          inputMode="numeric"
          value={String(value)}
          disabled={disabled}
          onChange={(event) => {
            const parsed = Number(event.target.value)
            if (!Number.isFinite(parsed)) return
            onChange(Math.min(max, Math.max(min, Math.round(parsed))))
          }}
          className={suffix ? 'pr-10' : undefined}
        />
        {suffix && (
          <span
            aria-hidden
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
          >
            {suffix}
          </span>
        )}
      </div>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  )
}

function TextRow({
  id,
  label,
  value,
  maxLength,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: string
  maxLength?: number
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function HourSelect({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string
  value: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-9 rounded-lg border bg-background px-2.5 text-sm tabular-nums"
    >
      {Array.from({ length: 24 }, (_, hour) => (
        <option key={hour} value={hour}>
          {String(hour).padStart(2, '0')}:00
        </option>
      ))}
    </select>
  )
}
