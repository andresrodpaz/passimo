'use client'

import * as React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  Loader2,
  Check,
  QrCode,
  Copy,
  ExternalLink,
  Users,
  Palette,
  Bell,
  Building2,
  Rocket,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useApi, apiPatch, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { AsyncBoundary } from '@/components/states'
import { useClientValue } from '@/lib/client/hooks'
import { CardPreview } from '@/components/wallet/card-preview'
import { PlatformSwitch } from '@/components/wallet/platform-switch'
import type { CardDesignResponse } from '@/components/wallet/design-types'
import { resolveCardDesign } from '@/lib/wallet/card-design'
import { toastError } from '@/lib/client/api-errors'
import { useI18n } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'

type SettingsResponse = {
  business: {
    id: string
    name: string
    slug: string
    category: string | null
    city: string | null
    phone: string | null
    support_email: string | null
    website: string | null
    google_review_url: string | null
    timezone: string
    currency: string
    locale: string
    primary_color: string
    accent_color: string
    text_color: string
    logo_url: string | null
    settings: { quiet_hours?: { start: string; end: string }; weekly_message_cap?: number }
  }
  team: Array<{
    id: string
    role: string
    status: string
    display_name: string | null
    invited_email: string | null
    last_active_at: string | null
  }>
  role: string
  capabilities: Record<string, boolean>
}

/**
 * Settings.
 *
 * Grouped by intent rather than by table, and every change saves to the
 * database — the previous version was a form that showed a success toast and
 * discarded the input.
 */
export default function SettingsPage() {
  const { businessId, can } = useWorkspace()
  const { t } = useI18n()
  const { data, error, isLoading, mutate } = useApi<SettingsResponse>(
    businessId ? `/api/v1/businesses/${businessId}` : null
  )

  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">{t('settings.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('settings.subtitle')}</p>
      </header>

      <AsyncBoundary data={data} error={error} isLoading={isLoading} onRetry={() => void mutate()}>
        {(settings) => (
          <Tabs defaultValue="business">
            <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
              <TabsTrigger value="business" className="gap-1.5">
                <Building2 className="size-3.5" />
                {t('settings.tabBusiness')}
              </TabsTrigger>
              <TabsTrigger value="card" className="gap-1.5">
                <Palette className="size-3.5" />
                {t('settings.tabCard')}
              </TabsTrigger>
              <TabsTrigger value="signup" className="gap-1.5">
                <QrCode className="size-3.5" />
                {t('settings.tabSignup')}
              </TabsTrigger>
              <TabsTrigger value="team" className="gap-1.5">
                <Users className="size-3.5" />
                {t('settings.tabTeam')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="business" className="mt-5 space-y-5">
              <BusinessForm
                settings={settings}
                editable={can('settings:write')}
                onSaved={() => void mutate()}
              />
              <MessagingForm
                settings={settings}
                editable={can('settings:write')}
                onSaved={() => void mutate()}
              />
              <ChecklistRestore editable={can('settings:write')} />
              <ChannelStatus capabilities={settings.capabilities} />
            </TabsContent>

            <TabsContent value="card" className="mt-5">
              <CardSummary settings={settings} />
            </TabsContent>

            <TabsContent value="signup" className="mt-5">
              <SignupPanel slug={settings.business.slug} name={settings.business.name} />
            </TabsContent>

            <TabsContent value="team" className="mt-5">
              <TeamPanel settings={settings} />
            </TabsContent>
          </Tabs>
        )}
      </AsyncBoundary>
    </div>
  )
}

function useSaver(businessId: string | null, onSaved: () => void) {
  const { t } = useI18n()
  const [busy, setBusy] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const save = React.useCallback(
    async (patch: Record<string, unknown>) => {
      if (!businessId) return
      setBusy(true)
      setError(null)
      try {
        await apiPatch(`/api/v1/businesses/${businessId}`, patch)
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
        onSaved()
      } catch (cause) {
        setError(toastError(cause, t, 'common.couldNotSave'))
      } finally {
        setBusy(false)
      }
    },
    [businessId, onSaved, t]
  )

  return { save, busy, saved, error }
}

function BusinessForm({
  settings,
  editable,
  onSaved,
}: {
  settings: SettingsResponse
  editable: boolean
  onSaved: () => void
}) {
  const { businessId } = useWorkspace()
  const { t } = useI18n()
  const { save, busy, saved, error } = useSaver(businessId, onSaved)
  const business = settings.business

  const [form, setForm] = React.useState({
    name: business.name,
    city: business.city ?? '',
    phone: business.phone ?? '',
    supportEmail: business.support_email ?? '',
    website: business.website ?? '',
    googleReviewUrl: business.google_review_url ?? '',
    currency: business.currency,
    locale: business.locale,
  })

  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="text-base font-semibold">{t('settings.businessDetails')}</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label={t('settings.name')} id="name">
          <Input
            id="name"
            value={form.name}
            disabled={!editable}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <Field label={t('settings.city')} id="city">
          <Input
            id="city"
            value={form.city}
            disabled={!editable}
            onChange={(event) => setForm({ ...form, city: event.target.value })}
          />
        </Field>
        <Field label={t('settings.phone')} id="phone">
          <Input
            id="phone"
            value={form.phone}
            disabled={!editable}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
          />
        </Field>
        <Field label={t('settings.supportEmail')} id="supportEmail">
          <Input
            id="supportEmail"
            type="email"
            value={form.supportEmail}
            disabled={!editable}
            onChange={(event) => setForm({ ...form, supportEmail: event.target.value })}
          />
        </Field>
        <Field label={t('settings.website')} id="website">
          <Input
            id="website"
            value={form.website}
            disabled={!editable}
            placeholder="https://"
            onChange={(event) => setForm({ ...form, website: event.target.value })}
          />
        </Field>
        <Field
          label={t('settings.googleReviewUrl')}
          id="googleReviewUrl"
          hint={t('settings.googleReviewUrlHint')}
        >
          <Input
            id="googleReviewUrl"
            value={form.googleReviewUrl}
            disabled={!editable}
            placeholder="https://g.page/r/…"
            onChange={(event) => setForm({ ...form, googleReviewUrl: event.target.value })}
          />
        </Field>
        <Field label={t('settings.currency')} id="currency">
          <Select
            value={form.currency}
            disabled={!editable}
            onValueChange={(value) => setForm({ ...form, currency: value })}
          >
            <SelectTrigger id="currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['EUR', 'GBP', 'USD', 'CHF', 'SEK'].map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('settings.language')} id="locale">
          <Select
            value={form.locale}
            disabled={!editable}
            onValueChange={(value) => setForm({ ...form, locale: value })}
          >
            <SelectTrigger id="locale">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Endonyms, not translations: a language menu is the one place
                  every option should read in its own language. */}
              <SelectItem value="es">Español</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {editable && (
        <Button
          className="mt-5 gap-2"
          disabled={busy}
          onClick={() =>
            void save({
              name: form.name,
              city: form.city || null,
              phone: form.phone || null,
              supportEmail: form.supportEmail || null,
              website: form.website || null,
              googleReviewUrl: form.googleReviewUrl || null,
              currency: form.currency,
              locale: form.locale,
            })
          }
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : saved ? (
            <Check className="size-4" />
          ) : null}
          {saved ? t('common.saved') : t('common.saveChanges')}
        </Button>
      )}
    </section>
  )
}

function MessagingForm({
  settings,
  editable,
  onSaved,
}: {
  settings: SettingsResponse
  editable: boolean
  onSaved: () => void
}) {
  const { businessId } = useWorkspace()
  const { t } = useI18n()
  const { save, busy, saved } = useSaver(businessId, onSaved)
  const current = settings.business.settings ?? {}

  const [quietStart, setQuietStart] = React.useState(current.quiet_hours?.start ?? '21:00')
  const [quietEnd, setQuietEnd] = React.useState(current.quiet_hours?.end ?? '09:00')
  const [cap, setCap] = React.useState(String(current.weekly_message_cap ?? 3))

  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <Bell className="size-4" />
        {t('settings.messagingRules')}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('settings.messagingRulesBody')}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label={t('settings.quietStart')} id="quietStart">
          <Input
            id="quietStart"
            type="time"
            value={quietStart}
            disabled={!editable}
            onChange={(event) => setQuietStart(event.target.value)}
          />
        </Field>
        <Field label={t('settings.quietEnd')} id="quietEnd">
          <Input
            id="quietEnd"
            type="time"
            value={quietEnd}
            disabled={!editable}
            onChange={(event) => setQuietEnd(event.target.value)}
          />
        </Field>
        <Field label={t('settings.weeklyCap')} id="cap" hint={t('settings.weeklyCapHint')}>
          <Input
            id="cap"
            type="number"
            min={0}
            max={20}
            value={cap}
            disabled={!editable}
            onChange={(event) => setCap(event.target.value)}
          />
        </Field>
      </div>

      {editable && (
        <Button
          variant="outline"
          className="mt-4 gap-2"
          disabled={busy}
          onClick={() =>
            void save({
              settings: {
                quiet_hours: { start: quietStart, end: quietEnd },
                weekly_message_cap: Number(cap) || 0,
              },
            })
          }
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : saved ? (
            <Check className="size-4" />
          ) : null}
          {saved ? t('common.saved') : t('settings.saveRules')}
        </Button>
      )}
    </section>
  )
}

/**
 * Bringing the first-steps checklist back.
 *
 * The dismissal copy says "you can bring it back from Settings", and a product
 * that promises a control has to have one — a merchant who hid the checklist on
 * their first afternoon and then wanted the list of things they had skipped
 * would otherwise have no way back to it.
 *
 * Only shown once it has actually been dismissed. An always-visible "restore"
 * button for something already on screen is noise.
 */
function ChecklistRestore({ editable }: { editable: boolean }) {
  const { businessId } = useWorkspace()
  const { t } = useI18n()
  const [busy, setBusy] = React.useState(false)

  const { data, mutate } = useApi<{ dismissed: boolean }>(
    businessId ? `/api/v1/onboarding${query({ businessId })}` : null
  )

  if (!editable || !data?.dismissed) return null

  async function restore() {
    if (!businessId) return
    setBusy(true)
    try {
      await apiPatch('/api/v1/onboarding', { businessId, checklistDismissed: false })
      void mutate()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="text-base font-semibold">{t('checklist.title')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('checklist.subtitle')}</p>
      <Button
        variant="outline"
        className="mt-4 gap-2"
        disabled={busy}
        onClick={() => void restore()}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
        {t('checklist.restore')}
      </Button>
    </section>
  )
}

function ChannelStatus({ capabilities }: { capabilities: Record<string, boolean> }) {
  const { t } = useI18n()

  const rows: Array<{ key: string; labelKey: TranslationKey; noteKey: TranslationKey }> = [
    { key: 'email', labelKey: 'settings.channelEmail', noteKey: 'settings.noteResend' },
    { key: 'sms', labelKey: 'settings.channelSms', noteKey: 'settings.noteTwilio' },
    { key: 'whatsapp', labelKey: 'settings.channelWhatsapp', noteKey: 'settings.noteMeta' },
    { key: 'appleWallet', labelKey: 'settings.channelAppleWallet', noteKey: 'settings.noteApple' },
    { key: 'googleWallet', labelKey: 'settings.channelGoogleWallet', noteKey: 'settings.noteGoogle' },
    { key: 'ai', labelKey: 'settings.channelAi', noteKey: 'settings.noteAnthropic' },
    { key: 'billing', labelKey: 'settings.channelBilling', noteKey: 'settings.noteStripe' },
  ]

  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="text-base font-semibold">{t('settings.channels')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('settings.channelsBody')}</p>
      <ul className="mt-4 divide-y">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between py-2.5">
            <div>
              <p className="text-sm font-medium">{t(row.labelKey)}</p>
              <p className="text-xs text-muted-foreground">{t(row.noteKey)}</p>
            </div>
            <Badge variant={capabilities[row.key] ? 'secondary' : 'outline'}>
              {capabilities[row.key] ? t('common.ready') : t('common.notConfigured')}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The card, and the way to change it.
 *
 * This tab used to be a second card editor: three colour swatches writing
 * `businesses.primary_color / accent_color / text_color`, previewed against a
 * generic `LoyaltyCard` that shares no code with a real pass. It was the third
 * place a merchant could set a card colour, and the only one whose preview did
 * not resemble the card their customer holds.
 *
 * There is now one editor, in `/dashboard/wallet`, rendering the same
 * `CardPreview` the pass content resolves through. This tab shows the current
 * card and sends the merchant there — a shortcut rather than a duplicate,
 * because deleting it entirely would break the path of every merchant who has
 * learned that card appearance lives under Settings.
 */
function CardSummary({ settings }: { settings: SettingsResponse }) {
  const { businessId } = useWorkspace()
  const { t } = useI18n()
  const [platform, setPlatform] = React.useState<'apple' | 'google'>('apple')

  const { data } = useApi<CardDesignResponse>(
    businessId ? `/api/v1/wallet/design${query({ businessId })}` : null
  )

  const brand = data?.brand
  const resolved = React.useMemo(() => {
    if (!brand || !data) return null
    return resolveCardDesign(data.design, brand, {
      goal: data.program.goal,
      isStampProgram: data.program.isStampProgram,
    })
  }, [brand, data])

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <section className="rounded-xl border bg-card p-5">
        <h3 className="text-base font-semibold">{t('settings.cardDesign')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('settings.cardDesignBody')}</p>

        <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
          {(
            [
              'settings.cardDesignBullets.templates',
              'settings.cardDesignBullets.colors',
              'settings.cardDesignBullets.logo',
              'settings.cardDesignBullets.fields',
            ] as const
          ).map((key) => (
            <li key={key} className="flex items-start gap-2">
              <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden />
              {t(key)}
            </li>
          ))}
        </ul>

        <Button asChild className="mt-5 gap-2">
          <Link href="/dashboard/wallet">
            <Palette className="size-4" aria-hidden />
            {t('settings.openCardDesigner')}
          </Link>
        </Button>
      </section>

      <section className="rounded-xl border bg-muted/30 p-6">
        <PlatformSwitch value={platform} onChange={setPlatform} className="mx-auto mb-4 max-w-xs" />
        <div className="flex justify-center">
          {resolved && data ? (
            <CardPreview
              platform={platform}
              design={resolved}
              data={{
                organizationName: settings.business.name,
                programName: data.program.name ?? t('cardDesign.preview.defaultProgram'),
                memberName: t('settings.previewMember'),
                memberSince: null,
                tierName: null,
                locationName: data.locationName,
                balance:
                  data.program.goal && data.program.goal > 0
                    ? Math.max(1, Math.floor(data.program.goal / 2))
                    : 840,
                goal: data.program.goal,
                unitSingular:
                  data.program.unitSingular ?? t('cardDesign.preview.defaultUnitSingular'),
                unitPlural: data.program.unitPlural ?? t('cardDesign.preview.defaultUnitPlural'),
                rewardName: data.program.rewardName,
              }}
            />
          ) : (
            <Skeleton className="h-[380px] w-full max-w-[340px] rounded-[1.25rem]" />
          )}
        </div>
      </section>
    </div>
  )
}

function SignupPanel({ slug, name }: { slug: string; name: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = React.useState(false)
  // Read through an external store so the server and first client render agree.
  const origin = useClientValue(() => window.location.origin, '')
  const joinUrl = `${origin}/join/${slug}`

  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="text-base font-semibold">{t('settings.signupLink')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('settings.signupLinkBody')}</p>

      <div className="mt-5 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        {origin && (
          <Image
            src={`/api/v1/public/qr?data=${encodeURIComponent(joinUrl)}`}
            alt={t('settings.qrAlt', { name })}
            width={180}
            height={180}
            unoptimized
            className="rounded-lg border bg-white p-2"
          />
        )}

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex gap-2">
            <Input readOnly value={joinUrl} className="font-mono text-xs" />
            <Button
              variant="outline"
              size="icon"
              aria-label={t('settings.copyLink')}
              onClick={() => {
                void navigator.clipboard.writeText(joinUrl)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </Button>
          </div>

          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href={joinUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-3.5" />
                {t('common.preview')}
              </a>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a
                href={`/api/v1/public/qr?data=${encodeURIComponent(joinUrl)}&size=1024&download=1`}
                download={`${slug}-qr.png`}
              >
                {t('common.downloadForPrint')}
              </a>
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">{t('settings.signupNote')}</p>
        </div>
      </div>
    </section>
  )
}

function TeamPanel({ settings }: { settings: SettingsResponse }) {
  const { t, formatDate } = useI18n()

  return (
    <section className="rounded-xl border bg-card p-5">
      <h3 className="text-base font-semibold">{t('settings.team')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('settings.teamBody')}</p>
      <ul className="mt-4 divide-y">
        {settings.team.map((member) => {
          const roleKey = `settings.roles.${member.role}` as TranslationKey
          const roleLabel = t(roleKey)
          return (
            <li key={member.id} className="flex items-center justify-between py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {member.display_name ?? member.invited_email ?? t('settings.teamMember')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {member.status === 'invited'
                    ? t('settings.invitationPending')
                    : member.last_active_at
                      ? t('settings.lastActive', { date: formatDate(member.last_active_at) })
                      : t('settings.neverSignedIn')}
                </p>
              </div>
              <Badge variant={member.role === 'owner' ? 'default' : 'outline'}>
                {roleLabel === roleKey ? member.role : roleLabel}
              </Badge>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string
  id: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
