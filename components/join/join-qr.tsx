'use client'

import * as React from 'react'
import Image from 'next/image'
import { QrCode } from 'lucide-react'
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * The join QR, with somewhere to go when it cannot be rendered.
 *
 * Three screens print this code — settings, growth and the last step of
 * onboarding — and all three used to render a bare `<img>` at the QR endpoint.
 * That endpoint refuses to encode any URL outside this deployment's own origin,
 * deliberately: an open QR generator is a free phishing-image host, and the
 * domain gets blocklisted for it. The refusal is a `403` with a JSON body,
 * which is exactly the thing an `<img>` cannot show — so the merchant got the
 * browser's broken-image glyph and no explanation.
 *
 * The mismatch is not hypothetical. `settings` and `onboarding` build the join
 * URL from `window.location.origin`, while the endpoint validates against
 * `NEXT_PUBLIC_APP_URL`. Serve the app on any origin that variable does not
 * name — a different port in development, a preview deployment, a reverse proxy
 * terminating on another host — and every QR on the product 403s at once.
 *
 * So this component keeps the origin check exactly as it is and fixes the half
 * that was actually broken: the merchant now gets a diagnosis instead of a
 * glyph, and the link stays copyable from the surrounding panel either way,
 * because the link is not what failed.
 */

type Props = {
  /** The absolute URL the QR should encode. */
  joinUrl: string
  /** Rendered pixel size. The endpoint clamps its own `size` to 128–2048. */
  size?: number
  /** Requested render size, when it should differ from the displayed size. */
  renderSize?: number
  className?: string
  alt: string
}

export function JoinQr({ joinUrl, size = 180, renderSize, className, alt }: Props) {
  const { t } = useI18n()
  /*
   * Keyed by the URL rather than reset in an effect: a new target is a new
   * attempt, so recovering from a corrected `NEXT_PUBLIC_APP_URL` should not
   * need a reload, and deriving it during render avoids the extra commit an
   * effect would cost.
   */
  const [failedFor, setFailedFor] = React.useState<string | null>(null)
  const failed = failedFor === joinUrl

  if (!joinUrl) return null

  if (failed) {
    return (
      <div
        role="status"
        style={{ width: size, height: size }}
        className={cn(
          'flex shrink-0 flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/40 p-4 text-center',
          className
        )}
      >
        <QrCode className="size-6 text-muted-foreground" aria-hidden />
        <p className="text-xs font-medium">{t('qr.unavailable')}</p>
        <p className="text-[11px] leading-snug text-muted-foreground">{t('qr.unavailableBody')}</p>
      </div>
    )
  }

  return (
    <Image
      src={`/api/v1/public/qr?data=${encodeURIComponent(joinUrl)}&size=${renderSize ?? size * 3}`}
      alt={alt}
      width={size}
      height={size}
      unoptimized
      onError={() => setFailedFor(joinUrl)}
      className={cn('shrink-0 rounded-lg border bg-white p-2', className)}
    />
  )
}
