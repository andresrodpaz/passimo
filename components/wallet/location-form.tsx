'use client'

import * as React from 'react'
import { Compass, Loader2, MapPin, Radio } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { apiPost } from '@/lib/client/api'
import { useI18n } from '@/lib/i18n'
import { WEEKDAYS, type OpeningHours, type StoreLocation, type Weekday } from '@/lib/wallet/types'
import { OpeningHoursEditor } from '@/components/wallet/opening-hours-editor'

/**
 * The store location form.
 *
 * Long, because a location genuinely has this many knobs and the product principle
 * is that every one of them belongs to the merchant. What keeps it usable is the
 * ordering: identity, then where, then when it is open, then how far it reaches.
 * A merchant adding their first shop can stop after the second block and have a
 * working setup; the geofence section defaults sensibly and is collapsed behind its
 * own heading.
 *
 * Two decisions worth stating:
 *
 *   * **Coordinates are always editable, geocoding is a shortcut.** The "find
 *     coordinates" button fills the two fields; it never replaces them. A merchant on
 *     a deployment with no Maps key sees the same form with a note, not a broken one.
 *
 *   * **Radius inputs are metres, not a slider.** A café owner who has decided their
 *     radius is "the end of the street" knows it in metres and wants to type it. A
 *     slider makes an exact value hard to hit and adds no information.
 */

export type LocationFormValues = {
  name: string
  description: string
  address: string
  addressLine2: string
  city: string
  region: string
  postalCode: string
  country: string
  phone: string
  email: string
  lat: string
  lng: string
  isVisible: boolean
  isDefault: boolean
  openingHours: OpeningHours
  geofenceEnabled: boolean
  relevanceRadiusMeters: string
  notificationRadiusMeters: string
  secondaryRadiusMeters: string
  triggerOnEntry: boolean
  triggerOnExit: boolean
  triggerOnDwell: boolean
  dwellMinutes: string
  relevantText: string
  beaconUuid: string
  beaconMajor: string
  beaconMinor: string
  externalRef: string
}

export function emptyLocationValues(defaults: {
  radiusMeters: number
  dwellMinutes: number
}): LocationFormValues {
  return {
    name: '',
    description: '',
    address: '',
    addressLine2: '',
    city: '',
    region: '',
    postalCode: '',
    country: '',
    phone: '',
    email: '',
    lat: '',
    lng: '',
    isVisible: true,
    isDefault: false,
    openingHours: {},
    geofenceEnabled: true,
    relevanceRadiusMeters: String(defaults.radiusMeters),
    notificationRadiusMeters: '',
    secondaryRadiusMeters: '',
    triggerOnEntry: true,
    triggerOnExit: false,
    triggerOnDwell: false,
    dwellMinutes: String(defaults.dwellMinutes),
    relevantText: '',
    beaconUuid: '',
    beaconMajor: '',
    beaconMinor: '',
    externalRef: '',
  }
}

export function locationToValues(location: StoreLocation): LocationFormValues {
  return {
    name: location.name,
    description: location.description ?? '',
    address: location.address ?? '',
    addressLine2: location.addressLine2 ?? '',
    city: location.city ?? '',
    region: location.region ?? '',
    postalCode: location.postalCode ?? '',
    country: location.country ?? '',
    phone: location.phone ?? '',
    email: location.email ?? '',
    lat: location.coordinates ? String(location.coordinates.lat) : '',
    lng: location.coordinates ? String(location.coordinates.lng) : '',
    isVisible: location.isVisible,
    isDefault: location.isDefault,
    openingHours: location.openingHours,
    geofenceEnabled: location.geofence.enabled,
    relevanceRadiusMeters: String(location.geofence.relevanceRadiusMeters),
    notificationRadiusMeters:
      location.geofence.notificationRadiusMeters === location.geofence.relevanceRadiusMeters
        ? ''
        : String(location.geofence.notificationRadiusMeters),
    secondaryRadiusMeters: location.geofence.secondaryRadiusMeters
      ? String(location.geofence.secondaryRadiusMeters)
      : '',
    triggerOnEntry: location.geofence.triggerOnEntry,
    triggerOnExit: location.geofence.triggerOnExit,
    triggerOnDwell: location.geofence.triggerOnDwell,
    dwellMinutes: String(location.geofence.dwellMinutes),
    relevantText: location.relevantText ?? '',
    beaconUuid: location.beacon?.uuid ?? '',
    beaconMajor: location.beacon?.major !== null && location.beacon?.major !== undefined ? String(location.beacon.major) : '',
    beaconMinor: location.beacon?.minor !== null && location.beacon?.minor !== undefined ? String(location.beacon.minor) : '',
    externalRef: location.externalRef ?? '',
  }
}

const numberOrNull = (value: string): number | null => {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

const textOrNull = (value: string): string | null => (value.trim() === '' ? null : value.trim())

/** Maps the form back to the API shape. Kept next to the form so the two cannot drift. */
export function valuesToPayload(values: LocationFormValues): Record<string, unknown> {
  return {
    name: values.name.trim(),
    description: textOrNull(values.description),
    address: textOrNull(values.address),
    addressLine2: textOrNull(values.addressLine2),
    city: textOrNull(values.city),
    region: textOrNull(values.region),
    postalCode: textOrNull(values.postalCode),
    country: textOrNull(values.country)?.toUpperCase() ?? null,
    phone: textOrNull(values.phone),
    email: textOrNull(values.email),
    lat: numberOrNull(values.lat),
    lng: numberOrNull(values.lng),
    isVisible: values.isVisible,
    isDefault: values.isDefault,
    openingHours: values.openingHours,
    geofenceEnabled: values.geofenceEnabled,
    relevanceRadiusMeters: numberOrNull(values.relevanceRadiusMeters),
    notificationRadiusMeters: numberOrNull(values.notificationRadiusMeters),
    secondaryRadiusMeters: numberOrNull(values.secondaryRadiusMeters),
    triggerOnEntry: values.triggerOnEntry,
    triggerOnExit: values.triggerOnExit,
    triggerOnDwell: values.triggerOnDwell,
    dwellMinutes: numberOrNull(values.dwellMinutes),
    relevantText: textOrNull(values.relevantText),
    beaconUuid: textOrNull(values.beaconUuid),
    beaconMajor: numberOrNull(values.beaconMajor),
    beaconMinor: numberOrNull(values.beaconMinor),
    externalRef: textOrNull(values.externalRef),
  }
}

type GeocodeResponse =
  | {
      ok: true
      result: {
        coordinates: { lat: number; lng: number }
        formattedAddress: string | null
        city: string | null
        region: string | null
        postalCode: string | null
        country: string | null
      }
    }
  | { ok: false; reason: string; hint?: string }

export function LocationForm({
  businessId,
  values,
  onChange,
  geocodingConfigured,
}: {
  businessId: string
  values: LocationFormValues
  onChange: (values: LocationFormValues) => void
  geocodingConfigured: boolean
}) {
  const { t } = useI18n()
  const [geocoding, setGeocoding] = React.useState(false)
  const [geocodeMessage, setGeocodeMessage] = React.useState<
    { kind: 'found' | 'error'; text: string } | null
  >(null)

  const set = <K extends keyof LocationFormValues>(key: K, value: LocationFormValues[K]) =>
    onChange({ ...values, [key]: value })

  async function lookUp() {
    const address = [values.address, values.city, values.postalCode, values.country]
      .filter((part) => part.trim() !== '')
      .join(', ')
    if (address.length < 3) return

    setGeocoding(true)
    setGeocodeMessage(null)
    try {
      const response = await apiPost<GeocodeResponse>('/api/v1/locations/geocode', {
        businessId,
        address,
        mode: 'geocode',
      })

      if (response.ok) {
        // Only fill in what the merchant left blank. Overwriting a city they typed
        // with Google's version of it is how a form starts feeling adversarial.
        onChange({
          ...values,
          lat: String(response.result.coordinates.lat),
          lng: String(response.result.coordinates.lng),
          city: values.city || (response.result.city ?? ''),
          region: values.region || (response.result.region ?? ''),
          postalCode: values.postalCode || (response.result.postalCode ?? ''),
          country: values.country || (response.result.country ?? ''),
        })
        setGeocodeMessage({
          kind: 'found',
          text: t('locations.geocode.found', {
            address: response.result.formattedAddress ?? address,
          }),
        })
      } else {
        setGeocodeMessage({
          kind: 'error',
          text:
            response.reason === 'not_configured'
              ? t('locations.geocode.notConfigured')
              : t('locations.geocode.notFound'),
        })
      }
    } catch {
      setGeocodeMessage({ kind: 'error', text: t('locations.geocode.notFound') })
    } finally {
      setGeocoding(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Identity */}
      <section className="space-y-4">
        <Field label={t('locations.fields.name')} htmlFor="loc-name" required>
          <Input
            id="loc-name"
            value={values.name}
            onChange={(event) => set('name', event.target.value)}
            placeholder={t('locations.fields.namePlaceholder')}
            required
            maxLength={120}
          />
        </Field>

        <Field label={t('locations.fields.description')} htmlFor="loc-description">
          <Textarea
            id="loc-description"
            value={values.description}
            onChange={(event) => set('description', event.target.value)}
            rows={2}
            maxLength={500}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('locations.fields.phone')} htmlFor="loc-phone">
            <Input
              id="loc-phone"
              type="tel"
              value={values.phone}
              onChange={(event) => set('phone', event.target.value)}
            />
          </Field>
          <Field label={t('locations.fields.email')} htmlFor="loc-email">
            <Input
              id="loc-email"
              type="email"
              value={values.email}
              onChange={(event) => set('email', event.target.value)}
            />
          </Field>
        </div>

        <div className="flex items-center justify-between rounded-xl border p-3.5">
          <Label htmlFor="loc-visible" className="cursor-pointer pr-4 text-sm font-normal">
            {t('locations.fields.visibility')}
          </Label>
          <Switch
            id="loc-visible"
            checked={values.isVisible}
            onCheckedChange={(checked) => set('isVisible', checked)}
          />
        </div>

        <div className="flex items-center justify-between rounded-xl border p-3.5">
          <Label htmlFor="loc-default" className="cursor-pointer pr-4 text-sm font-normal">
            {t('locations.makePrimary')}
          </Label>
          <Switch
            id="loc-default"
            checked={values.isDefault}
            onCheckedChange={(checked) => set('isDefault', checked)}
          />
        </div>
      </section>

      <Separator />

      {/* Where */}
      <section className="space-y-4">
        <SectionTitle icon={MapPin} title={t('locations.fields.address')} />

        <Field label={t('locations.fields.address')} htmlFor="loc-address">
          <Input
            id="loc-address"
            value={values.address}
            onChange={(event) => set('address', event.target.value)}
            autoComplete="street-address"
          />
        </Field>
        <Field label={t('locations.fields.addressLine2')} htmlFor="loc-address2">
          <Input
            id="loc-address2"
            value={values.addressLine2}
            onChange={(event) => set('addressLine2', event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('locations.fields.city')} htmlFor="loc-city">
            <Input
              id="loc-city"
              value={values.city}
              onChange={(event) => set('city', event.target.value)}
            />
          </Field>
          <Field label={t('locations.fields.postalCode')} htmlFor="loc-postal">
            <Input
              id="loc-postal"
              value={values.postalCode}
              onChange={(event) => set('postalCode', event.target.value)}
            />
          </Field>
          <Field label={t('locations.fields.country')} htmlFor="loc-country">
            <Input
              id="loc-country"
              value={values.country}
              onChange={(event) => set('country', event.target.value)}
              maxLength={2}
              placeholder="ES"
            />
          </Field>
        </div>

        <div className="rounded-xl border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">{t('locations.fields.coordinates')}</p>
            {geocodingConfigured && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={lookUp}
                disabled={geocoding || values.address.trim().length < 3}
                className="gap-2"
              >
                {geocoding ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Compass className="size-3.5" aria-hidden />
                )}
                {geocoding ? t('locations.geocode.lookingUp') : t('locations.geocode.lookUp')}
              </Button>
            )}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label={t('locations.fields.latitude')} htmlFor="loc-lat">
              <Input
                id="loc-lat"
                inputMode="decimal"
                value={values.lat}
                onChange={(event) => set('lat', event.target.value)}
                placeholder="40.4168"
              />
            </Field>
            <Field label={t('locations.fields.longitude')} htmlFor="loc-lng">
              <Input
                id="loc-lng"
                inputMode="decimal"
                value={values.lng}
                onChange={(event) => set('lng', event.target.value)}
                placeholder="-3.7038"
              />
            </Field>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            {geocodingConfigured
              ? t('locations.geocode.manualHint')
              : t('locations.geocode.notConfigured')}
          </p>

          {geocodeMessage && (
            <Alert
              variant={geocodeMessage.kind === 'error' ? 'destructive' : 'default'}
              className="mt-3"
            >
              <AlertDescription>{geocodeMessage.text}</AlertDescription>
            </Alert>
          )}
        </div>
      </section>

      <Separator />

      {/* When */}
      <section className="space-y-3">
        <SectionTitle icon={MapPin} title={t('locations.hours.title')} />
        <p className="text-sm text-muted-foreground">{t('locations.hours.subtitle')}</p>
        <OpeningHoursEditor
          value={values.openingHours}
          onChange={(hours) => set('openingHours', hours)}
        />
      </section>

      <Separator />

      {/* How far it reaches */}
      <section className="space-y-4">
        <SectionTitle icon={Radio} title={t('locations.geofence.title')} />
        <p className="text-sm text-muted-foreground">{t('locations.geofence.subtitle')}</p>

        {!values.lat || !values.lng ? (
          <Alert>
            <AlertDescription>{t('locations.geofence.noCoordinates')}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-center justify-between rounded-xl border p-3.5">
          <Label htmlFor="loc-geofence" className="cursor-pointer pr-4 text-sm font-normal">
            {t('locations.geofence.enabled')}
          </Label>
          <Switch
            id="loc-geofence"
            checked={values.geofenceEnabled}
            onCheckedChange={(checked) => set('geofenceEnabled', checked)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label={t('locations.geofence.relevanceRadius')}
            htmlFor="loc-radius"
            help={t('locations.geofence.relevanceRadiusHelp')}
          >
            <MetreInput
              id="loc-radius"
              value={values.relevanceRadiusMeters}
              onChange={(value) => set('relevanceRadiusMeters', value)}
            />
          </Field>
          <Field
            label={t('locations.geofence.notificationRadius')}
            htmlFor="loc-notify-radius"
            help={t('locations.geofence.notificationRadiusHelp')}
          >
            <MetreInput
              id="loc-notify-radius"
              value={values.notificationRadiusMeters}
              onChange={(value) => set('notificationRadiusMeters', value)}
              placeholder={values.relevanceRadiusMeters}
            />
          </Field>
          <Field
            label={t('locations.geofence.secondaryRadius')}
            htmlFor="loc-secondary-radius"
            help={t('locations.geofence.secondaryRadiusHelp')}
          >
            <MetreInput
              id="loc-secondary-radius"
              value={values.secondaryRadiusMeters}
              onChange={(value) => set('secondaryRadiusMeters', value)}
            />
          </Field>
        </div>

        <fieldset className="space-y-2.5 rounded-xl border p-4">
          <legend className="px-1 text-sm font-medium">{t('locations.geofence.triggers')}</legend>

          <ToggleRow
            id="loc-entry"
            label={t('locations.geofence.onEntry')}
            help={t('locations.geofence.onEntryHelp')}
            checked={values.triggerOnEntry}
            onChange={(checked) => set('triggerOnEntry', checked)}
          />
          <ToggleRow
            id="loc-exit"
            label={t('locations.geofence.onExit')}
            help={t('locations.geofence.onExitHelp')}
            checked={values.triggerOnExit}
            onChange={(checked) => set('triggerOnExit', checked)}
          />
          <ToggleRow
            id="loc-dwell"
            label={t('locations.geofence.onDwell')}
            help={t('locations.geofence.onDwellHelp')}
            checked={values.triggerOnDwell}
            onChange={(checked) => set('triggerOnDwell', checked)}
          />

          {values.triggerOnDwell && (
            <Field label={t('locations.geofence.dwellMinutes')} htmlFor="loc-dwell-minutes">
              <div className="flex items-center gap-2">
                <Input
                  id="loc-dwell-minutes"
                  inputMode="numeric"
                  className="max-w-24"
                  value={values.dwellMinutes}
                  onChange={(event) => set('dwellMinutes', event.target.value)}
                />
                <span className="text-sm text-muted-foreground">
                  {t('common.minutes', { count: Number(values.dwellMinutes) || 0 }).replace(
                    /^\d+\s*/,
                    ''
                  )}
                </span>
              </div>
            </Field>
          )}
        </fieldset>

        <Field
          label={t('locations.geofence.relevantText')}
          htmlFor="loc-relevant"
          help={t('locations.geofence.relevantTextHelp')}
        >
          <Input
            id="loc-relevant"
            value={values.relevantText}
            onChange={(event) => set('relevantText', event.target.value)}
            placeholder={t('locations.geofence.relevantTextPlaceholder')}
            maxLength={160}
          />
        </Field>

        <details className="rounded-xl border">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            {t('locations.geofence.beacon')}
          </summary>
          <div className="space-y-3 border-t p-4">
            <p className="text-sm text-muted-foreground">{t('locations.geofence.beaconHelp')}</p>
            <Field label={t('locations.geofence.beaconUuid')} htmlFor="loc-beacon-uuid">
              <Input
                id="loc-beacon-uuid"
                value={values.beaconUuid}
                onChange={(event) => set('beaconUuid', event.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('locations.geofence.beaconMajor')} htmlFor="loc-beacon-major">
                <Input
                  id="loc-beacon-major"
                  inputMode="numeric"
                  value={values.beaconMajor}
                  onChange={(event) => set('beaconMajor', event.target.value)}
                />
              </Field>
              <Field label={t('locations.geofence.beaconMinor')} htmlFor="loc-beacon-minor">
                <Input
                  id="loc-beacon-minor"
                  inputMode="numeric"
                  value={values.beaconMinor}
                  onChange={(event) => set('beaconMinor', event.target.value)}
                />
              </Field>
            </div>
          </div>
        </details>

        <Field label={t('locations.fields.externalRef')} htmlFor="loc-ref">
          <Input
            id="loc-ref"
            value={values.externalRef}
            onChange={(event) => set('externalRef', event.target.value)}
            maxLength={80}
          />
        </Field>
      </section>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Small shared pieces
// -----------------------------------------------------------------------------

function Field({
  label,
  htmlFor,
  help,
  required,
  children,
}: {
  label: string
  htmlFor: string
  help?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  )
}

function SectionTitle({
  icon: Icon,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
}) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      {title}
    </h3>
  )
}

/** A metre input with its unit inside the field, so the number needs no label. */
function MetreInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="pr-9"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
      >
        m
      </span>
    </div>
  )
}

function ToggleRow({
  id,
  label,
  help,
  checked,
  onChange,
}: {
  id: string
  label: string
  help: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="min-w-0">
        <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
          {label}
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5 shrink-0" />
    </div>
  )
}

export { WEEKDAYS }
export type { Weekday }
