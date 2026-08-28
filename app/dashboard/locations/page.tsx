'use client'

import * as React from 'react'
import {
  AlertTriangle,
  Archive,
  Clock,
  Loader2,
  Plus,
  Radio,
  Star,
  Store,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { EmptyState, ErrorState, LoadingRows } from '@/components/states'
import { UpgradePrompt } from '@/components/billing/upgrade'
import {
  LocationForm,
  emptyLocationValues,
  locationToValues,
  valuesToPayload,
  type LocationFormValues,
} from '@/components/wallet/location-form'
import { apiDelete, apiPatch, apiPost, useApi, query } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { useI18n } from '@/lib/i18n'
import type { StoreLocation } from '@/lib/wallet/types'
import type { CapabilityReport } from '@/lib/env'

/**
 * Store locations.
 *
 * The screen a multi-site merchant lives in, and the prerequisite for every
 * proximity feature: a geofence needs a centre. Each row shows the two things that
 * decide whether the location is actually *working* — does it have coordinates, and
 * is its geofence on — because a location with a beautiful address and no latitude
 * silently does nothing, and that is the failure a merchant cannot diagnose alone.
 */

type LocationsResponse = { locations: StoreLocation[] }
type MeResponse = { capabilities: CapabilityReport }

export default function LocationsPage() {
  const { t } = useI18n()
  const { businessId, can, has, entitlements } = useWorkspace()

  const { data, error, isLoading, mutate } = useApi<LocationsResponse>(
    businessId ? `/api/v1/locations${query({ businessId })}` : null
  )
  const { data: me } = useApi<MeResponse>('/api/v1/me')

  const [editing, setEditing] = React.useState<StoreLocation | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [archiving, setArchiving] = React.useState<StoreLocation | null>(null)
  const [importing, setImporting] = React.useState(false)

  const locations = data?.locations ?? []
  const canWrite = can('locations:write')
  const multiLocation = has('multi_location')
  const locationLimit = entitlements?.limits.locations ?? null
  const atLimit = locationLimit !== null && locations.length >= locationLimit

  const closeDialogs = () => {
    setEditing(null)
    setCreating(false)
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('locations.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('locations.subtitle')}</p>
        </div>

        {canWrite && (
          <div className="flex gap-2">
            {multiLocation && (
              <Button variant="outline" onClick={() => setImporting(true)} className="gap-2">
                <Upload className="size-4" aria-hidden />
                <span className="hidden sm:inline">{t('locations.importLocations')}</span>
              </Button>
            )}
            <Button onClick={() => setCreating(true)} disabled={atLimit} className="gap-2">
              <Plus className="size-4" aria-hidden />
              {t('locations.addLocation')}
            </Button>
          </div>
        )}
      </header>

      {/* At the cap, the merchant needs the remedy, not a disabled button with no
          explanation. `UpgradePrompt` names the cheapest plan that would clear it. */}
      {atLimit && canWrite && (
        <UpgradePrompt
          limit="locations"
          used={locations.length}
          allowed={locationLimit ?? undefined}
        />
      )}

      {isLoading && <LoadingRows rows={3} />}
      {error && <ErrorState error={error} onRetry={() => void mutate()} />}

      {!isLoading && !error && locations.length === 0 && (
        <EmptyState
          icon={Store}
          title={t('locations.empty')}
          description={t('locations.emptyBody')}
          action={
            canWrite ? (
              <Button onClick={() => setCreating(true)} className="gap-2">
                <Plus className="size-4" aria-hidden />
                {t('locations.addLocation')}
              </Button>
            ) : undefined
          }
        />
      )}

      {locations.length > 0 && (
        <ul className="grid gap-4 lg:grid-cols-2">
          {locations.map((location) => (
            <li key={location.id}>
              <LocationCard
                location={location}
                canWrite={canWrite}
                onEdit={() => setEditing(location)}
                onArchive={() => setArchiving(location)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Create / edit */}
      <Dialog open={creating || editing !== null} onOpenChange={(open) => !open && closeDialogs()}>
        <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? t('locations.editLocation') : t('locations.addLocation')}
            </DialogTitle>
            <DialogDescription>{t('locations.subtitle')}</DialogDescription>
          </DialogHeader>

          {businessId && (
            <LocationEditor
              businessId={businessId}
              location={editing}
              geocodingConfigured={Boolean(me?.capabilities?.geocoding)}
              defaults={{ radiusMeters: 200, dwellMinutes: 5 }}
              onSaved={() => {
                closeDialogs()
                void mutate()
              }}
              onCancel={closeDialogs}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Archive confirmation */}
      <AlertDialog open={archiving !== null} onOpenChange={(open) => !open && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('locations.archive')}</AlertDialogTitle>
            <AlertDialogDescription>{t('locations.archiveConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!archiving || !businessId) return
                try {
                  await apiDelete('/api/v1/locations', { businessId, id: archiving.id })
                  toast.success(t('common.saved'))
                } catch (cause) {
                  toast.error(
                    cause instanceof Error ? cause.message : t('common.somethingWentWrong')
                  )
                }
                setArchiving(null)
                void mutate()
              }}
            >
              {t('locations.archive')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImportDialog
        open={importing}
        businessId={businessId}
        onClose={() => setImporting(false)}
        onImported={() => {
          setImporting(false)
          void mutate()
        }}
      />
    </div>
  )
}

// -----------------------------------------------------------------------------
// Card
// -----------------------------------------------------------------------------

function LocationCard({
  location,
  canWrite,
  onEdit,
  onArchive,
}: {
  location: StoreLocation
  canWrite: boolean
  onEdit: () => void
  onArchive: () => void
}) {
  const { t } = useI18n()

  const hasCoordinates = Boolean(location.coordinates)
  const geofenceLive = hasCoordinates && location.geofence.enabled
  const hoursSet = Object.keys(location.openingHours).length > 0

  const triggers = [
    location.geofence.triggerOnEntry && t('locations.geofence.onEntry'),
    location.geofence.triggerOnExit && t('locations.geofence.onExit'),
    location.geofence.triggerOnDwell && t('locations.geofence.onDwell'),
  ].filter(Boolean) as string[]

  return (
    <article className="flex h-full flex-col rounded-2xl border bg-card p-5 transition-shadow hover:shadow-md">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <span className="truncate">{location.name}</span>
            {location.isDefault && (
              <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label={t('locations.primary')} />
            )}
          </h2>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {[location.address, location.city].filter(Boolean).join(', ') || '—'}
          </p>
        </div>

        <div className="flex shrink-0 gap-1.5">
          {!location.isVisible && (
            <Badge variant="outline" className="text-xs">
              {t('locations.hidden')}
            </Badge>
          )}
        </div>
      </header>

      {/* The two states that decide whether this location does anything. Surfacing
          them here rather than inside the edit dialog is deliberate: a merchant
          scanning the list should be able to see which shop is silently inert. */}
      <div className="mt-4 flex flex-wrap gap-2">
        {!hasCoordinates ? (
          <Badge variant="destructive" className="gap-1.5">
            <AlertTriangle className="size-3" aria-hidden />
            {t('locations.geofence.noCoordinates')}
          </Badge>
        ) : (
          <Badge variant={geofenceLive ? 'secondary' : 'outline'} className="gap-1.5">
            <Radio className="size-3" aria-hidden />
            {geofenceLive
              ? t('common.metres', { value: location.geofence.notificationRadiusMeters })
              : t('common.disabled')}
          </Badge>
        )}

        <Badge variant="outline" className="gap-1.5">
          <Clock className="size-3" aria-hidden />
          {hoursSet ? t('locations.hours.title') : t('common.none')}
        </Badge>
      </div>

      {geofenceLive && triggers.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t('locations.geofence.triggers')}: {triggers.join(' · ')}
        </p>
      )}

      {location.relevantText && (
        <p className="mt-3 rounded-lg bg-muted/50 p-2.5 text-xs italic text-muted-foreground">
          “{location.relevantText}”
        </p>
      )}

      <footer className="mt-auto flex gap-2 pt-4">
        <Button variant="outline" size="sm" onClick={onEdit} className="flex-1">
          {canWrite ? t('common.edit') : t('common.preview')}
        </Button>
        {canWrite && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onArchive}
            className="gap-1.5 text-muted-foreground"
          >
            <Archive className="size-3.5" aria-hidden />
            <span className="sr-only sm:not-sr-only">{t('locations.archive')}</span>
          </Button>
        )}
      </footer>
    </article>
  )
}

// -----------------------------------------------------------------------------
// Editor
// -----------------------------------------------------------------------------

function LocationEditor({
  businessId,
  location,
  geocodingConfigured,
  defaults,
  onSaved,
  onCancel,
}: {
  businessId: string
  location: StoreLocation | null
  geocodingConfigured: boolean
  defaults: { radiusMeters: number; dwellMinutes: number }
  onSaved: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [values, setValues] = React.useState<LocationFormValues>(() =>
    location ? locationToValues(location) : emptyLocationValues(defaults)
  )
  const [saving, setSaving] = React.useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!values.name.trim()) return

    setSaving(true)
    try {
      const payload = { businessId, ...valuesToPayload(values) }
      if (location) {
        await apiPatch('/api/v1/locations', { ...payload, id: location.id })
      } else {
        await apiPost('/api/v1/locations', payload)
      }
      toast.success(t('common.saved'))
      onSaved()
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('common.somethingWentWrong'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <LocationForm
        businessId={businessId}
        values={values}
        onChange={setValues}
        geocodingConfigured={geocodingConfigured}
      />

      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={saving || !values.name.trim()} className="gap-2">
          {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  )
}

// -----------------------------------------------------------------------------
// Import
// -----------------------------------------------------------------------------

type ImportResult = {
  created: number
  updated: number
  errors: Array<{ row: number; message: string }>
}

/**
 * CSV import.
 *
 * Parsed in the browser so the merchant sees the row count and any obviously broken
 * lines before anything is sent — and so a 400-store spreadsheet never becomes a
 * multi-megabyte request body. Header names are matched loosely because the file
 * comes out of whatever system the chain already uses.
 */
function ImportDialog({
  open,
  businessId,
  onClose,
  onImported,
}: {
  open: boolean
  businessId: string | null
  onClose: () => void
  onImported: () => void
}) {
  const { t } = useI18n()
  const [text, setText] = React.useState('')
  const [importing, setImporting] = React.useState(false)
  const [result, setResult] = React.useState<ImportResult | null>(null)

  const parsed = React.useMemo(() => parseCsv(text), [text])

  async function run() {
    if (!businessId || parsed.length === 0) return
    setImporting(true)
    try {
      const response = await apiPost<ImportResult>('/api/v1/locations/import', {
        businessId,
        locations: parsed,
      })
      setResult(response)
      if (response.errors.length === 0) {
        toast.success(t('common.saved'))
        onImported()
      }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : t('common.somethingWentWrong'))
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('locations.importLocations')}</DialogTitle>
          <DialogDescription>
            name, address, city, postal_code, country, lat, lng, phone, external_ref
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label htmlFor="import-csv" className="sr-only">
            {t('locations.importLocations')}
          </label>
          <textarea
            id="import-csv"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full rounded-xl border bg-background p-3 font-mono text-xs"
            placeholder={
              'name,address,city,lat,lng\nGran Vía,Gran Vía 1,Madrid,40.4200,-3.7025'
            }
          />

          {parsed.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {t('common.done')}: {parsed.length}
            </p>
          )}

          {result && result.errors.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
              {result.errors.map((entry) => (
                <li key={entry.row}>
                  {entry.row}: {entry.message}
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={run} disabled={importing || parsed.length === 0} className="gap-2">
            {importing && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('locations.importLocations')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const HEADER_ALIASES: Record<string, string> = {
  name: 'name',
  store: 'name',
  location: 'name',
  address: 'address',
  address1: 'address',
  street: 'address',
  address2: 'addressLine2',
  city: 'city',
  town: 'city',
  region: 'region',
  province: 'region',
  state: 'region',
  postal_code: 'postalCode',
  postcode: 'postalCode',
  zip: 'postalCode',
  country: 'country',
  phone: 'phone',
  telephone: 'phone',
  email: 'email',
  lat: 'lat',
  latitude: 'lat',
  lng: 'lng',
  lon: 'lng',
  longitude: 'lng',
  external_ref: 'externalRef',
  ref: 'externalRef',
  id: 'externalRef',
}

/**
 * A minimal CSV reader.
 *
 * Handles quoted fields containing commas, which is the only complication real
 * address data reliably produces. Anything more exotic than that is a sign the
 * merchant should fix their export, and a full parser here would be more code than
 * the feature.
 */
function parseCsv(input: string): Array<Record<string, unknown>> {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length < 2) return []

  const headers = splitRow(lines[0]).map(
    (header) => HEADER_ALIASES[header.trim().toLowerCase().replace(/\s+/g, '_')] ?? null
  )

  const rows: Array<Record<string, unknown>> = []
  for (const line of lines.slice(1)) {
    const cells = splitRow(line)
    const row: Record<string, unknown> = {}
    headers.forEach((key, index) => {
      if (!key) return
      const value = (cells[index] ?? '').trim()
      if (value === '') return
      row[key] = key === 'lat' || key === 'lng' ? Number(value) : value
    })
    if (typeof row.name === 'string' && row.name.length > 0) rows.push(row)
  }
  return rows.slice(0, 500)
}

function splitRow(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      // A doubled quote inside a quoted field is an escaped quote.
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells
}
