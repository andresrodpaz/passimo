'use client'

import * as React from 'react'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import { ApiError } from '@/lib/client/api'
import { LOGO_ACCEPT, MAX_LOGO_BYTES, checkLogo, type LogoRejection } from '@/lib/brand/logo'
import type { TranslationKey } from '@/lib/i18n/dictionaries/en'

/**
 * The logo control.
 *
 * The single most consequential field in the brand kit: it is the one thing on a
 * customer's card that is unmistakably *this shop* rather than a colour anyone
 * could have picked. It therefore has to work for someone whose only copy of
 * their logo is a PNG on their phone — which means a file picker, not a URL
 * field, and certainly not "ask your web person for a link".
 *
 * Two behaviours worth stating:
 *
 * **The file is checked before it is sent.** The same `checkLogo` the route runs
 * server-side runs here first, so a merchant who picks a 9 MB photo is told in
 * the same second rather than after a slow upload that ends in a 413 they will
 * read as "the product is broken".
 *
 * **There is a fallback, and it is honest about being one.** On a deployment
 * with no storage configured the picker is replaced by a URL field rather than a
 * button that always fails. That is the state a self-hosted install without a
 * volume is genuinely in, and pretending otherwise costs the merchant an
 * afternoon.
 */

export type LogoFieldProps = {
  value: string | null
  /** False when this deployment cannot store files; shows the URL fallback. */
  uploadsEnabled: boolean
  disabled?: boolean
  /** Uploads the bytes and resolves to the stored URL. */
  onUpload: (file: File) => Promise<string>
  onChange: (value: string | null) => void
  /** Painted behind the mark, so contrast is judged against the real card. */
  previewBackground?: string
  className?: string
}

const REJECTION_KEYS: Record<LogoRejection, TranslationKey> = {
  empty: 'brandKit.logoErrors.empty',
  too_large: 'brandKit.logoErrors.tooLarge',
  unsupported_format: 'brandKit.logoErrors.unsupportedFormat',
}

export function LogoField({
  value,
  uploadsEnabled,
  disabled = false,
  onUpload,
  onChange,
  previewBackground,
  className,
}: LogoFieldProps) {
  const { t, formatNumber } = useI18n()
  const inputId = React.useId()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const fileInput = React.useRef<HTMLInputElement>(null)

  async function accept(file: File | undefined) {
    if (!file) return
    setError(null)

    const bytes = new Uint8Array(await file.arrayBuffer())
    const check = checkLogo(bytes)
    if (!check.ok) {
      setError(t(REJECTION_KEYS[check.reason], { max: formatNumber(MAX_LOGO_BYTES / 1024 / 1024) }))
      return
    }

    setBusy(true)
    try {
      onChange(await onUpload(file))
    } catch (cause) {
      /*
       * The route reports a rejection as a `reason` code precisely so it can be
       * translated here. Falling back to the API's own message would put an
       * English sentence in a Spanish dashboard.
       */
      const reason =
        cause instanceof ApiError
          ? (cause.details as { reason?: LogoRejection } | undefined)?.reason
          : undefined
      setError(
        reason
          ? t(REJECTION_KEYS[reason], { max: formatNumber(MAX_LOGO_BYTES / 1024 / 1024) })
          : t('brandKit.logoErrors.uploadFailed')
      )
    } finally {
      setBusy(false)
      // Clearing lets the same file be re-picked after a failure; without this
      // the change event does not fire the second time.
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={inputId}>{t('brandKit.logo')}</Label>

      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border"
          style={previewBackground ? { backgroundColor: previewBackground } : undefined}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="size-full object-contain p-1.5" />
          ) : (
            <ImagePlus className="size-5 text-muted-foreground" />
          )}
        </span>

        <div className="min-w-0 flex-1 space-y-2">
          {uploadsEnabled ? (
            <>
              <input
                id={inputId}
                ref={fileInput}
                type="file"
                accept={LOGO_ACCEPT}
                disabled={disabled || busy}
                onChange={(event) => void accept(event.target.files?.[0])}
                className="sr-only"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || busy}
                  onClick={() => fileInput.current?.click()}
                  className="gap-2"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <ImagePlus className="size-4" aria-hidden />
                  )}
                  {busy
                    ? t('brandKit.logoUploading')
                    : value
                      ? t('brandKit.logoReplace')
                      : t('brandKit.logoUpload')}
                </Button>

                {value && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disabled || busy}
                    onClick={() => {
                      setError(null)
                      onChange(null)
                    }}
                    className="gap-2 text-muted-foreground"
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {t('common.remove')}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t('brandKit.logoHint')}</p>
            </>
          ) : (
            <>
              <Input
                id={inputId}
                value={value ?? ''}
                disabled={disabled}
                placeholder="https://"
                inputMode="url"
                onChange={(event) => onChange(event.target.value.trim() || null)}
              />
              <p className="text-xs text-muted-foreground">{t('brandKit.logoUrlFallback')}</p>
            </>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
