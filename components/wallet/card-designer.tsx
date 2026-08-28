'use client'

import * as React from 'react'
import { Check, Eye, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import { CardPreview, type CardPreviewData } from '@/components/wallet/card-preview'
import { PlatformSwitch } from '@/components/wallet/platform-switch'
import { LogoField } from '@/components/brand/logo-field'
import {
  CARD_STYLES,
  PROGRESS_STYLES,
  TYPOGRAPHIES,
  MAX_RENDERABLE_STAMPS,
  cardBackground,
  contrastRatio,
  meetsContrastAA,
  normalizeHex,
  resolveCardDesign,
  type CardDesign,
  type CardStyle,
  type ProgressStyle,
  type Typography,
} from '@/lib/wallet/card-design'
import { CARD_TEMPLATES, applyCardTemplate, findCardTemplate } from '@/lib/wallet/card-templates'
import type { BrandKit } from '@/lib/brand/kit'
import type { TranslationKey } from '@/lib/i18n/dictionaries/en'

/**
 * The card designer.
 *
 * The product rule it exists to satisfy: a merchant customises the thing their
 * customer will hold, sees the result immediately, and never touches code or
 * files a support ticket to do it.
 *
 * Two decisions worth stating, because both were the obvious-but-wrong option:
 *
 * **The preview is not a mock.** It renders through `resolveCardDesign` — the
 * same function the pass builder calls — so inheritance, contrast correction and
 * the auto progress choice all behave identically here and on the customer's
 * phone. A second, prettier implementation would drift the first time either
 * side changed, and the merchant would only find out from a customer.
 *
 * **Every edit is local until saved.** No autosave, no request per keystroke. A
 * merchant dragging a colour picker generates dozens of values a second, and the
 * card their customers hold should not follow along; it changes when they say it
 * does. The unsaved badge makes that state legible rather than implicit.
 */

export type CardDesignerProps = {
  design: CardDesign
  brand: BrandKit
  /** The real program, so the preview shows the merchant's own numbers. */
  program: {
    goal: number | null
    isStampProgram: boolean
    unitSingular: string
    unitPlural: string
    rewardName: string | null
    programName: string
  }
  sampleLocationName?: string | null
  saving?: boolean
  readOnly?: boolean
  /**
   * Uploads a logo and resolves to its URL.
   *
   * The logo lives on the brand kit, not on the design — one business has one
   * logo, and giving the card its own copy is how a merchant ends up rebranding
   * twice. The control is here anyway because this is the screen where they can
   * see what it looks like, and sending them to another tab to change the single
   * most visible thing on the card is the friction this whole screen exists to
   * remove. Omitted where no upload is possible (onboarding before provisioning,
   * a deployment with no storage).
   */
  onUploadLogo?: (file: File) => Promise<string>
  /** Stores the chosen logo on the brand kit, or clears it when null. */
  onLogoChange?: (logoUrl: string | null) => void
  uploadsEnabled?: boolean
  onSave: (design: CardDesign) => void
  className?: string
}

export function CardDesigner({
  design: saved,
  brand,
  program,
  sampleLocationName = null,
  saving = false,
  readOnly = false,
  onUploadLogo,
  onLogoChange,
  uploadsEnabled = false,
  onSave,
  className,
}: CardDesignerProps) {
  const { t } = useI18n()
  const [draft, setDraft] = React.useState<CardDesign>(saved)
  const [platform, setPlatform] = React.useState<'apple' | 'google'>('apple')
  const [showBack, setShowBack] = React.useState(false)

  /*
   * There is no effect re-syncing `draft` from `saved`, deliberately.
   *
   * The obvious `useEffect(() => setDraft(saved), [saved])` is a cascading
   * render, and it is also wrong: SWR hands back a *new object* on every
   * revalidation, so a background refetch while a merchant was mid-edit would
   * silently discard what they had typed. The parent remounts this component
   * keyed on the design's content instead — identical content keeps the key and
   * the draft; a real save changes it and reseeds cleanly.
   */

  const dirty = React.useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved]
  )

  const set = React.useCallback(<K extends keyof CardDesign>(key: K, value: CardDesign[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }, [])

  const resolved = React.useMemo(
    () => resolveCardDesign(draft, brand, { goal: program.goal, isStampProgram: program.isStampProgram }),
    [draft, brand, program.goal, program.isStampProgram]
  )

  /*
   * The preview shows the merchant's real program with a sample customer part
   * way through it. Halfway rather than empty or complete: an empty card hides
   * the progress rendering they are choosing, and a finished one hides the
   * "n to go" line. Halfway is the state a customer is in almost always.
   */
  const previewData: CardPreviewData = React.useMemo(() => {
    const goal = program.goal
    const balance = goal && goal > 0 ? Math.max(1, Math.floor(goal / 2)) : 840
    return {
      organizationName: brand.name || t('common.appName'),
      programName: program.programName,
      memberName: t('cardDesign.preview.sampleCustomer'),
      memberSince: null,
      tierName: t('landing.demo.tiers.silver'),
      locationName: sampleLocationName,
      balance,
      goal,
      unitSingular: program.unitSingular,
      unitPlural: program.unitPlural,
      rewardName: program.rewardName,
      // The reverse carries the brand kit's details, which is where they
      // actually surface on a customer's card.
      contact: {
        description: brand.description,
        website: brand.contact.website,
        phone: brand.contact.phone,
        email: brand.contact.email,
        address: [brand.contact.address, brand.contact.city].filter(Boolean).join(', ') || null,
        socials: brand.socials,
      },
    }
  }, [brand, program, sampleLocationName, t])

  // `memberSince` is generated rather than passed so the preview never shows a
  // date formatted by a different rule than the pass builder uses.
  const previewWithSince: CardPreviewData = React.useMemo(
    () => ({ ...previewData, memberSince: draft.showMemberSince ? sinceLabel() : null }),
    [previewData, draft.showMemberSince]
  )

  const contrastProblem =
    draft.foregroundColor !== null &&
    !meetsContrastAA(draft.foregroundColor, resolved.backgroundColor)

  const stampsUnavailable =
    draft.progressStyle === 'stamps' &&
    program.goal !== null &&
    program.goal > MAX_RENDERABLE_STAMPS

  return (
    <div className={cn('grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]', className)}>
      {/*
        Controls.

        A `fieldset` rather than a `disabled` prop threaded through twenty
        controls: `fieldset[disabled]` disables every nested form control
        natively, including the Radix switches and the template buttons, and it
        is announced as such. Threading the prop by hand is how one control gets
        missed and a viewer edits a card they cannot save.
      */}
      <fieldset
        disabled={readOnly}
        className="order-2 min-w-0 space-y-8 lg:order-1 disabled:opacity-100"
      >
        <Templates
          value={draft.template}
          disabled={readOnly}
          onApply={(key) => {
            const template = findCardTemplate(key)
            if (template) setDraft((current) => applyCardTemplate(current, template))
          }}
        />

        {onUploadLogo && onLogoChange && (
          <Section title={t('cardDesign.logo.title')}>
            <LogoField
              value={brand.logoUrl}
              uploadsEnabled={uploadsEnabled}
              disabled={readOnly}
              previewBackground={resolved.backgroundColor}
              onUpload={onUploadLogo}
              onChange={onLogoChange}
            />
            <p className="mt-2 text-xs text-muted-foreground">{t('cardDesign.logo.sharedHint')}</p>
          </Section>
        )}

        <Section title={t('cardDesign.style.title')}>
          <ChoiceRow
            options={CARD_STYLES.map((style) => ({
              value: style,
              label: t(`cardDesign.style.${style}` as TranslationKey),
            }))}
            value={draft.cardStyle}
            onChange={(value) => set('cardStyle', value as CardStyle)}
            renderSwatch={(value) => (
              <span
                aria-hidden
                className="block h-8 w-full rounded-md ring-1 ring-black/10"
                style={{
                  background: cardBackground({
                    cardStyle: value as CardStyle,
                    backgroundColor: resolved.backgroundColor,
                    accentColor: resolved.accentColor,
                  }),
                }}
              />
            )}
          />
        </Section>

        <Section title={t('cardDesign.colors.title')}>
          <div className="grid gap-4 sm:grid-cols-3">
            <ColorField
              label={t('cardDesign.colors.background')}
              value={draft.backgroundColor}
              fallback={resolved.backgroundColor}
              onChange={(value) => set('backgroundColor', value)}
            />
            <ColorField
              label={t('cardDesign.colors.accent')}
              value={draft.accentColor}
              fallback={resolved.accentColor}
              onChange={(value) => set('accentColor', value)}
            />
            <ColorField
              label={t('cardDesign.colors.foreground')}
              value={draft.foregroundColor}
              fallback={resolved.foregroundColor}
              onChange={(value) => set('foregroundColor', value)}
              hint={draft.foregroundColor === null ? t('cardDesign.colors.autoText') : undefined}
            />
          </div>

          {contrastProblem && (
            <p
              role="status"
              className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
            >
              {t('cardDesign.colors.contrastWarning')}{' '}
              <span className="tabular-nums opacity-70">
                ({contrastRatio(draft.foregroundColor!, resolved.backgroundColor).toFixed(1)}:1)
              </span>
            </p>
          )}
        </Section>

        <Section title={t('cardDesign.progress.title')}>
          <ChoiceRow
            options={PROGRESS_STYLES.map((style) => ({
              value: style,
              label: t(`cardDesign.progress.${style}` as TranslationKey),
            }))}
            value={draft.progressStyle}
            onChange={(value) => set('progressStyle', value as ProgressStyle)}
          />
          {draft.progressStyle === 'auto' && (
            <p className="mt-2 text-xs text-muted-foreground">{t('cardDesign.progress.autoHint')}</p>
          )}
          {stampsUnavailable && (
            <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              {t('cardDesign.progress.tooManyStamps', { count: program.goal! })}
            </p>
          )}
        </Section>

        <Section title={t('cardDesign.typography.title')}>
          <ChoiceRow
            options={TYPOGRAPHIES.map((face) => ({
              value: face,
              label: t(`cardDesign.typography.${face}` as TranslationKey),
            }))}
            value={draft.typography}
            onChange={(value) => set('typography', value as Typography)}
          />
        </Section>

        <Section title={t('cardDesign.show.title')}>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <ToggleRow
              label={t('cardDesign.show.progress')}
              checked={draft.showProgress}
              onChange={(value) => set('showProgress', value)}
            />
            <ToggleRow
              label={t('cardDesign.show.reward')}
              checked={draft.showReward}
              onChange={(value) => set('showReward', value)}
            />
            <ToggleRow
              label={t('cardDesign.show.memberName')}
              checked={draft.showMemberName}
              onChange={(value) => set('showMemberName', value)}
            />
            <ToggleRow
              label={t('cardDesign.show.memberSince')}
              checked={draft.showMemberSince}
              onChange={(value) => set('showMemberSince', value)}
            />
            <ToggleRow
              label={t('cardDesign.show.tier')}
              checked={draft.showTier}
              onChange={(value) => set('showTier', value)}
            />
            <ToggleRow
              label={t('cardDesign.show.location')}
              checked={draft.showLocation}
              onChange={(value) => set('showLocation', value)}
            />
          </div>
        </Section>

        <Section title={t('cardDesign.copy.title')}>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="card-headline">{t('cardDesign.copy.headline')}</Label>
              <Input
                id="card-headline"
                value={draft.headline ?? ''}
                maxLength={40}
                placeholder={t('cardDesign.copy.headlinePlaceholder')}
                onChange={(event) => set('headline', event.target.value || null)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="card-message">{t('cardDesign.copy.customMessage')}</Label>
              <Textarea
                id="card-message"
                rows={2}
                maxLength={280}
                value={draft.customMessage ?? ''}
                placeholder={t('cardDesign.copy.customMessagePlaceholder')}
                onChange={(event) => set('customMessage', event.target.value || null)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="card-terms">{t('cardDesign.copy.terms')}</Label>
              <Textarea
                id="card-terms"
                rows={2}
                maxLength={500}
                value={draft.termsText ?? ''}
                placeholder={t('cardDesign.copy.termsPlaceholder')}
                onChange={(event) => set('termsText', event.target.value || null)}
              />
            </div>
          </div>
        </Section>
      </fieldset>

      {/* Preview */}
      <div className="order-1 lg:order-2">
        <div className="lg:sticky lg:top-6">
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
              data={previewWithSince}
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
            {t('cardDesign.preview.disclaimer')}
          </p>

          {!readOnly && (
            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                className="flex-1"
                disabled={!dirty || saving}
                onClick={() => onSave(draft)}
              >
                {saving ? t('common.saving') : t('cardDesign.save')}
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
        </div>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Pieces
// -----------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function Templates({
  value,
  onApply,
  disabled,
}: {
  value: string
  onApply: (key: string) => void
  disabled?: boolean
}) {
  const { t } = useI18n()

  return (
    <section>
      <h3 className="text-sm font-semibold">{t('cardDesign.templates.title')}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{t('cardDesign.templates.subtitle')}</p>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {CARD_TEMPLATES.map((template) => {
          const active = value === template.key
          return (
            <button
              key={template.key}
              type="button"
              disabled={disabled}
              onClick={() => onApply(template.key)}
              aria-pressed={active}
              className={cn(
                'group rounded-xl border p-2 text-left transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed',
                active ? 'border-primary ring-2 ring-primary/30' : 'hover:border-foreground/30'
              )}
            >
              {/* A real miniature of the template, not a colour chip: the point
                  is that these differ in layout, and a chip hides exactly that. */}
              <span
                aria-hidden
                className="mb-2 flex h-14 w-full flex-col justify-between rounded-lg p-1.5 ring-1 ring-black/10"
                style={{
                  background: cardBackground({
                    cardStyle: template.design.cardStyle,
                    backgroundColor: template.design.backgroundColor,
                    accentColor: template.design.accentColor,
                  }),
                }}
              >
                <span
                  className="h-1 w-5 rounded-full"
                  style={{ backgroundColor: template.design.accentColor }}
                />
                {template.design.progressStyle === 'stamps' ? (
                  <span className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <span
                        key={index}
                        className="size-1.5 rounded-full"
                        style={{
                          backgroundColor:
                            index < 3 ? template.design.accentColor : 'rgba(255,255,255,0.28)',
                        }}
                      />
                    ))}
                  </span>
                ) : template.design.progressStyle === 'none' ? (
                  <span
                    className="h-1 w-8 rounded-full"
                    style={{ backgroundColor: 'rgba(255,255,255,0.28)' }}
                  />
                ) : (
                  <span className="h-1 w-full rounded-full bg-white/25">
                    <span
                      className="block h-full w-1/2 rounded-full"
                      style={{ backgroundColor: template.design.accentColor }}
                    />
                  </span>
                )}
              </span>

              <span className="flex items-center gap-1 text-xs font-medium">
                {t(template.nameKey)}
                {active && <Check className="size-3 shrink-0 text-primary" aria-hidden />}
              </span>
              <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                {t(template.descriptionKey)}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function ChoiceRow({
  options,
  value,
  onChange,
  renderSwatch,
}: {
  options: Array<{ value: string; label: string }>
  value: string
  onChange: (value: string) => void
  renderSwatch?: (value: string) => React.ReactNode
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              'min-w-[5.5rem] flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              active ? 'border-primary ring-2 ring-primary/30' : 'hover:border-foreground/30'
            )}
          >
            {renderSwatch?.(option.value)}
            <span className={cn('block', renderSwatch && 'mt-1.5')}>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * A colour field that can be unset.
 *
 * "Unset" is a first-class value, not an empty string: null means the card
 * inherits the brand kit, which is what most merchants want and what keeps a
 * rebrand from having to be applied twice. The reset control is the only way
 * back to it, so it is always present once a value is chosen.
 */
function ColorField({
  label,
  value,
  fallback,
  onChange,
  hint,
}: {
  label: string
  value: string | null
  fallback: string
  onChange: (value: string | null) => void
  hint?: string
}) {
  const { t } = useI18n()
  const id = React.useId()
  const inherited = value === null

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={value ?? fallback}
          onChange={(event) => onChange(normalizeHex(event.target.value))}
          className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
        />
        <Input
          value={value ?? ''}
          placeholder={fallback}
          aria-label={label}
          onChange={(event) => onChange(normalizeHex(event.target.value))}
          className="h-9 font-mono text-xs"
        />
        {!inherited && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            aria-label={t('cardDesign.colors.reset')}
            title={t('cardDesign.colors.reset')}
            onClick={() => onChange(null)}
          >
            <RotateCcw className="size-3.5" aria-hidden />
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {hint ?? (inherited ? t('cardDesign.colors.inherit') : undefined)}
      </p>
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  const id = React.useId()
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

/**
 * A plausible "member since" for the preview.
 *
 * Three months back rather than today, so the label reads as a returning
 * customer — which is the customer the merchant is designing for.
 */
function sinceLabel(): string {
  const date = new Date()
  date.setMonth(date.getMonth() - 3)
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}
