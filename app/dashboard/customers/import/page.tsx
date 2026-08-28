'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, Upload, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { apiPost } from '@/lib/client/api'
import { useWorkspace } from '@/lib/client/workspace'
import { toastError } from '@/lib/client/api-errors'
import { useI18n } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/i18n'

type Preview = {
  preview: true
  headers: string[]
  detected_mapping: Record<string, string>
  available_fields: string[]
  total_rows: number
  sample: Record<string, string>[]
  error?: string
}

type Started = { import_id: string; total_rows: number; queued: true }

/**
 * CSV import.
 *
 * Migrating an existing customer list is the biggest single blocker to
 * switching from a competitor or a paper punch-card, so this is forgiving:
 * columns are auto-detected, everything is previewed before anything is
 * written, and balances carry over so no customer loses progress.
 */
export default function ImportPage() {
  const { businessId } = useWorkspace()
  const { t, formatNumber } = useI18n()
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [csv, setCsv] = React.useState<string>('')
  const [filename, setFilename] = React.useState('')
  const [mapping, setMapping] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [started, setStarted] = React.useState<Started | null>(null)

  /**
   * The importable field names, which arrive from the API as identifiers.
   *
   * A field with no dictionary entry renders its own identifier rather than a
   * dotted key: the API can add a column before the dictionary catches up, and
   * "external_id" is still a usable label where "customers.importer.fields.x" is
   * not.
   */
  function fieldLabel(field: string): string {
    const key = `customers.importer.fields.${field}` as TranslationKey
    const label = t(key)
    return label === key ? field.replace(/_/g, ' ') : label
  }

  async function handleFile(file: File) {
    setError(null)
    setBusy(true)
    try {
      const text = await file.text()
      setCsv(text)
      setFilename(file.name)
      const response = await apiPost<Preview>('/api/v1/customers/import', {
        businessId,
        csv: text,
        filename: file.name,
        dryRun: true,
      })
      setPreview(response)
      setMapping(response.detected_mapping)
    } catch (cause) {
      setError(toastError(cause, t, 'customers.importer.readFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const response = await apiPost<Started>('/api/v1/customers/import', {
        businessId,
        csv,
        filename,
        mapping,
      })
      setStarted(response)
    } catch (cause) {
      setError(toastError(cause, t, 'customers.importer.startFailed'))
    } finally {
      setBusy(false)
    }
  }

  const mappedFields = new Set(Object.values(mapping))
  const canImport = mappedFields.has('email') || mappedFields.has('phone')

  return (
    <div className="max-w-3xl space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5">
        <Link href="/dashboard/customers">
          <ArrowLeft className="size-4" />
          {t('customers.importer.back')}
        </Link>
      </Button>

      <header>
        <h2 className="text-xl font-semibold tracking-tight">{t('customers.importer.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('customers.importer.subtitle')}</p>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {started ? (
        <section className="rounded-xl border bg-card p-6 text-center">
          <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
          <h3 className="mt-3 text-base font-semibold">{t('customers.importer.started')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('customers.importer.startedBody', { count: started.total_rows })}
          </p>
          <Button asChild className="mt-5">
            <Link href="/dashboard/customers">{t('customers.importer.backToCustomers')}</Link>
          </Button>
        </section>
      ) : !preview ? (
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center transition-colors hover:border-primary/50 hover:bg-accent/40">
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleFile(file)
            }}
          />
          {busy ? (
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          ) : (
            <Upload className="size-8 text-muted-foreground" />
          )}
          <span className="mt-3 text-sm font-medium">
            {busy ? t('customers.importer.reading') : t('customers.importer.chooseFile')}
          </span>
          <span className="mt-1 text-xs text-muted-foreground">
            {t('customers.importer.accepts')}
          </span>
        </label>
      ) : (
        <>
          <section className="rounded-xl border bg-card p-5">
            <h3 className="text-base font-semibold">{t('customers.importer.checkColumns')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('customers.importer.matched', {
                matched: formatNumber(Object.keys(mapping).length),
                total: formatNumber(preview.headers.length),
              })}
            </p>

            <div className="mt-4 space-y-3">
              {preview.headers.map((header) => (
                <div key={header} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{header}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {preview.sample[0]?.[header] || '—'}
                    </p>
                  </div>
                  <span className="text-muted-foreground" aria-hidden>
                    →
                  </span>
                  <Select
                    value={mapping[header] ?? 'skip'}
                    onValueChange={(value) =>
                      setMapping((current) => {
                        const next = { ...current }
                        if (value === 'skip') delete next[header]
                        else next[header] = value
                        return next
                      })
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skip">{t('customers.importer.skipColumn')}</SelectItem>
                      {preview.available_fields.map((field) => (
                        <SelectItem key={field} value={field}>
                          {fieldLabel(field)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {!canImport && (
              <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-500">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {t('customers.importer.needsIdentifier')}
              </p>
            )}
          </section>

          <section className="rounded-xl border bg-card p-5">
            <Label className="text-sm font-medium">{t('customers.importer.preview')}</Label>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    {preview.headers.slice(0, 6).map((header) => (
                      <th key={header} scope="col" className="px-2 py-1 font-medium">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.sample.map((row, index) => (
                    <tr key={index}>
                      {preview.headers.slice(0, 6).map((header) => (
                        <td key={header} className="max-w-[160px] truncate px-2 py-1.5">
                          {row[header]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {t('customers.importer.rowsTotal', { count: preview.total_rows })}
            </p>
          </section>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setPreview(null)}>
              {t('customers.importer.chooseAnother')}
            </Button>
            <Button className="gap-2" disabled={busy || !canImport} onClick={() => void confirm()}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t('customers.importer.importCta', { count: preview.total_rows })}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
