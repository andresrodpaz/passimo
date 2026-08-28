'use client'

import * as React from 'react'
import { Eye, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { AsyncBoundary } from '@/components/states'
import { LogoField } from '@/components/brand/logo-field'
import { CardPreview, type CardPreviewData } from '@/components/wallet/card-preview'
import { PlatformSwitch } from '@/components/wallet/platform-switch'
import { apiFetch, apiPatch, useApi, query } from '@/lib/client/api'
import { toastError } from '@/lib/client/api-errors'
import { useI18n } from '@/lib/i18n'
import { normalizeHex, resolveCardDesign, readableTextOn } from '@/lib/wallet/card-design'
import { DEFAULT_CARD_DESIGN, type CardDesign } from '@/lib/wallet/card-design'
import type { BrandKit } from '@/lib/brand/kit'
import type { CardDesignResponse } from '@/components/wallet/design-types'

/**
 * The brand kit editor.
 *
 * One screen answering "who is this business", reused by the wallet card, the
 * public join page, the browser card, transactional email and campaigns. It
 * exists because that identity used to be spread across a three-swatch control
 * in Settings, four columns on `wallet_settings` that quietly won, and four more
 * columns created by migration 21 that no screen could reach at all.
 *
 * The preview beside it is not decoration. Colour pickers are the one control
 * where the input is meaningless without the output: nobody can tell whether
 * `#3f2212` reads well behind white text by looking at the hex. It renders
 * through the same `resolveCardDesign` the pass builder uses, so the contrast
 * correction the merchant sees here is the one their customer gets.
 */

type BrandResponse = {
  brand: BrandKit
  uploads: { enabled: boolean }
}

export function BrandKitPanel({
  businessId,
  canWrite,
}: {
  businessId: string
  canWrite: boolean
}) {
  const brand = useApi<BrandResponse>(`/api/v1/brand${query({ businessId })}`)
  // Shares its SWR key with the card designer, so opening both tabs is one fetch.
  const design = useApi<CardDesignResponse>(`/api/v1/wallet/design${query({ businessId })}`)

  return (
    <AsyncBoundary
      data={brand.data}
      error={brand.error}
      isLoading={brand.isLoading}
      onRetry={() => void brand.mutate()}
    >
      {(loaded) => (
        <BrandKitForm
          /* Remount when the server hands back a different record, so the draft
             is seeded from props instead of synced into state after the fact. */
          key={loaded.brand.businessId}
          businessId={businessId}
          brand={loaded.brand}
          uploadsEnabled={loaded.uploads.enabled}
          design={design.data?.design ?? DEFAULT_CARD_DESIGN}
          program={design.data?.program ?? null}
          canWrite={canWrite}
          onSaved={() => {
            void brand.mutate()
            void design.mutate()
          }}
        />
      )}
    </AsyncBoundary>
  )
}

type Draft = {
  name: string
  description: string
  logoUrl: string | null
  primaryColor: string
  secondaryColor: string
  accentColor: string
  textColor: string
  email: string
  phone: string
  website: string
  address: string
  city: string
  postalCode: string
  country: string
  instagram: string
  facebook: string
  tiktok: string
}

function toDraft(brand: BrandKit): Draft {
  return {
    name: brand.name,
    description: brand.description ?? '',
    logoUrl: brand.logoUrl,
    primaryColor: brand.primaryColor,
    secondaryColor: brand.secondaryColor ?? '',
    accentColor: brand.accentColor,
    textColor: brand.textColor,
    email: brand.contact.email ?? '',
    phone: brand.contact.phone ?? '',
    website: brand.contact.website ?? '',
    address: brand.contact.address ?? '',
    city: brand.contact.city ?? '',
    postalCode: brand.contact.postalCode ?? '',
    country: brand.contact.country ?? '',
    instagram: brand.socials.instagram ?? '',
    facebook: brand.socials.facebook ?? '',
    tiktok: brand.socials.tiktok ?? '',
  }
}

function BrandKitForm({
  businessId,
  brand,
  uploadsEnabled,
  design,
  program,
  canWrite,
  onSaved,
}: {
  businessId: string
  brand: BrandKit
  uploadsEnabled: boolean
  design: CardDesign
  program: CardDesignResponse['program'] | null
  canWrite: boolean
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [saved, setSaved] = React.useState(() => toDraft(brand))
  const [draft, setDraft] = React.useState(saved)
  const [saving, setSaving] = React.useState(false)
  const [platform, setPlatform] = React.useState<'apple' | 'google'>('apple')
  const [showBack, setShowBack] = React.useState(false)

  const dirty = React.useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved]
  )

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  /*
   * The card as it stands with the merchant's *saved* design and their *draft*
   * brand. Only the colours they are dragging move; the layout stays whatever
   * they chose in the designer, which is the honest answer to "what does my
   * brand look like on my card".
   */
  const resolved = React.useMemo(
    () =>
      resolveCardDesign(
        design,
        {
          primaryColor: normalizeHex(draft.primaryColor) ?? brand.primaryColor,
          accentColor: normalizeHex(draft.accentColor) ?? brand.accentColor,
          textColor: normalizeHex(draft.textColor) ?? brand.textColor,
          logoUrl: draft.logoUrl,
        },
        {
          goal: program?.goal ?? null,
          isStampProgram: program?.isStampProgram ?? false,
        }
      ),
    [design, draft.primaryColor, draft.accentColor, draft.textColor, draft.logoUrl, brand, program]
  )

  const previewData: CardPreviewData = React.useMemo(() => {
    const goal = program?.goal ?? null
    return {
      organizationName: draft.name || t('common.appName'),
      programName: program?.name ?? t('cardDesign.preview.defaultProgram'),
      memberName: t('cardDesign.preview.sampleCustomer'),
      memberSince: null,
      tierName: t('landing.demo.tiers.silver'),
      locationName: draft.city || null,
      balance: goal && goal > 0 ? Math.max(1, Math.floor(goal / 2)) : 840,
      goal,
      unitSingular: program?.unitSingular ?? t('cardDesign.preview.defaultUnitSingular'),
      unitPlural: program?.unitPlural ?? t('cardDesign.preview.defaultUnitPlural'),
      rewardName: program?.rewardName ?? null,
      contact: {
        description: draft.description || null,
        website: draft.website || null,
        phone: draft.phone || null,
        email: draft.email || null,
        address: [draft.address, draft.city].filter(Boolean).join(', ') || null,
        socials: {
          instagram: draft.instagram || null,
          facebook: draft.facebook || null,
          tiktok: draft.tiktok || null,
        },
      },
    }
  }, [draft, program, t])

  async function uploadLogo(file: File): Promise<string> {
    const form = new FormData()
    form.append('file', file)
    const result = await apiFetch<{ logoUrl: string }>(
      `/api/v1/brand/logo${query({ businessId })}`,
      { method: 'POST', body: form }
    )
    /*
     * The upload writes `logo_url` itself, so the saved baseline moves with it.
     * Without this the merchant would be shown "unsaved changes" for a logo that
     * is already stored, and clicking Cancel would appear to revert it.
     */
    setSaved((current) => ({ ...current, logoUrl: result.logoUrl }))
    onSaved()
    return result.logoUrl
  }

  async function save() {
    setSaving(true)
    try {
      const next = await apiPatch<{ brand: BrandKit }>('/api/v1/brand', {
        businessId,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        logoUrl: draft.logoUrl,
        primaryColor: normalizeHex(draft.primaryColor) ?? brand.primaryColor,
        secondaryColor: normalizeHex(draft.secondaryColor),
        accentColor: normalizeHex(draft.accentColor) ?? brand.accentColor,
        textColor: normalizeHex(draft.textColor) ?? brand.textColor,
        supportEmail: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        website: draft.website.trim() || null,
        address: draft.address.trim() || null,
        city: draft.city.trim() || null,
        postalCode: draft.postalCode.trim() || null,
        country: draft.country.trim() || null,
        instagram: draft.instagram.trim() || null,
        facebook: draft.facebook.trim() || null,
        tiktok: draft.tiktok.trim() || null,
      })
      // Seed from what the server stored, not from the draft: handles are
      // normalised on the way in, so echoing the draft back would show the
      // merchant a pasted URL that is not what was saved.
      setSaved(toDraft(next.brand))
      setDraft(toDraft(next.brand))
      toast.success(t('brandKit.saved'))
      onSaved()
    } catch (cause) {
      toast.error(toastError(cause, t, 'brandKit.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
      <div className="space-y-6">
        <Section title={t('brandKit.identity')}>
          <div className="space-y-4">
            <TextField
              label={t('brandKit.name')}
              value={draft.name}
              disabled={!canWrite}
              maxLength={100}
              onChange={(value) => set('name', value)}
            />

            <div className="space-y-1.5">
              <Label htmlFor="brand-description">{t('brandKit.description')}</Label>
              <Textarea
                id="brand-description"
                rows={2}
                maxLength={280}
                value={draft.description}
                disabled={!canWrite}
                placeholder={t('brandKit.descriptionPlaceholder')}
                onChange={(event) => set('description', event.target.value)}
              />
            </div>

            <LogoField
              value={draft.logoUrl}
              uploadsEnabled={uploadsEnabled}
              disabled={!canWrite}
              previewBackground={resolved.backgroundColor}
              onUpload={uploadLogo}
              onChange={(value) => set('logoUrl', value)}
            />
          </div>
        </Section>

        <Section title={t('brandKit.colors')} description={t('brandKit.colorsHint')}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ColorField
              label={t('brandKit.primary')}
              value={draft.primaryColor}
              disabled={!canWrite}
              onChange={(value) => set('primaryColor', value)}
            />
            <ColorField
              label={t('brandKit.accent')}
              value={draft.accentColor}
              disabled={!canWrite}
              onChange={(value) => set('accentColor', value)}
            />
            <ColorField
              label={t('brandKit.secondary')}
              value={draft.secondaryColor}
              placeholder={t('brandKit.secondaryOptional')}
              disabled={!canWrite}
              onChange={(value) => set('secondaryColor', value)}
            />
            <ColorField
              label={t('brandKit.textColor')}
              value={draft.textColor}
              disabled={!canWrite}
              onChange={(value) => set('textColor', value)}
              /* Offering the legible answer costs one click and removes the
                 most common way a brand kit produces an unreadable card. */
              suggestion={readableTextOn(normalizeHex(draft.primaryColor) ?? brand.primaryColor)}
              suggestionLabel={t('brandKit.useLegibleText')}
            />
          </div>
        </Section>

        <Section title={t('brandKit.contact')} description={t('brandKit.contactHint')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('brandKit.email')}
              value={draft.email}
              type="email"
              disabled={!canWrite}
              onChange={(value) => set('email', value)}
            />
            <TextField
              label={t('brandKit.phone')}
              value={draft.phone}
              type="tel"
              disabled={!canWrite}
              onChange={(value) => set('phone', value)}
            />
            <TextField
              label={t('brandKit.website')}
              value={draft.website}
              placeholder="https://"
              disabled={!canWrite}
              onChange={(value) => set('website', value)}
            />
            <TextField
              label={t('brandKit.address')}
              value={draft.address}
              disabled={!canWrite}
              onChange={(value) => set('address', value)}
            />
            <TextField
              label={t('brandKit.city')}
              value={draft.city}
              disabled={!canWrite}
              onChange={(value) => set('city', value)}
            />
            <TextField
              label={t('brandKit.postalCode')}
              value={draft.postalCode}
              disabled={!canWrite}
              onChange={(value) => set('postalCode', value)}
            />
          </div>
        </Section>

        <Section title={t('brandKit.social')} description={t('brandKit.handleHint')}>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label={t('brandKit.instagram')}
              value={draft.instagram}
              placeholder={t('brandKit.handlePlaceholder')}
              disabled={!canWrite}
              onChange={(value) => set('instagram', value)}
            />
            <TextField
              label={t('brandKit.facebook')}
              value={draft.facebook}
              placeholder={t('brandKit.handlePlaceholder')}
              disabled={!canWrite}
              onChange={(value) => set('facebook', value)}
            />
            <TextField
              label={t('brandKit.tiktok')}
              value={draft.tiktok}
              placeholder={t('brandKit.handlePlaceholder')}
              disabled={!canWrite}
              onChange={(value) => set('tiktok', value)}
            />
          </div>
        </Section>
      </div>

      <aside className="xl:sticky xl:top-24">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{t('cardDesign.preview.title')}</p>
          {dirty && (
            <Badge variant="secondary" className="text-[10px]">
              {t('cardDesign.unsaved')}
            </Badge>
          )}
        </div>

        <PlatformSwitch value={platform} onChange={setPlatform} className="mb-4" />

        <div className="flex justify-center">
          <CardPreview
            platform={platform}
            design={resolved}
            data={previewData}
            showBack={showBack}
          />
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3 w-full gap-2"
          onClick={() => setShowBack((value) => !value)}
        >
          <Eye className="size-4" aria-hidden />
          {showBack ? t('cardDesign.back.showFront') : t('cardDesign.back.show')}
        </Button>

        <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">
          {t('brandKit.usedIn')}
        </p>

        {canWrite && (
          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              className="flex-1 gap-2"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {saving ? t('common.saving') : t('common.saveChanges')}
            </Button>
            {dirty && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t('common.cancel')}
                onClick={() => setDraft(saved)}
              >
                <RotateCcw className="size-4" aria-hidden />
              </Button>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Pieces
// -----------------------------------------------------------------------------

function Section({
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
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  maxLength,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  maxLength?: number
  disabled?: boolean
}) {
  const id = React.useId()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

/**
 * A colour input that only commits complete values.
 *
 * A half-typed `#1f2` is a valid three-digit hex, so committing on every
 * keystroke repaints the preview through colours the merchant never chose —
 * black, then a random blue, then their actual value. `normalizeHex` returning
 * null is the signal to keep the text but not the colour.
 */
function ColorField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  suggestion,
  suggestionLabel,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  suggestion?: string
  suggestionLabel?: string
}) {
  const id = React.useId()
  const normalized = normalizeHex(value)
  const showSuggestion =
    Boolean(suggestion && suggestionLabel) && normalized !== normalizeHex(suggestion ?? '')

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={normalized ?? '#000000'}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5 disabled:cursor-not-allowed"
        />
        <Input
          aria-label={label}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={7}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 font-mono text-xs"
        />
      </div>
      {showSuggestion && !disabled && (
        <button
          type="button"
          onClick={() => onChange(suggestion!)}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <span
            aria-hidden
            className="size-3 rounded-full ring-1 ring-black/20"
            style={{ backgroundColor: suggestion }}
          />
          {suggestionLabel}
        </button>
      )}
    </div>
  )
}
