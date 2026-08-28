/**
 * What counts as a logo.
 *
 * Isomorphic on purpose — no `server-only`. The file picker checks the same
 * rules before it uploads, so a merchant who selects a 9 MB screenshot is told
 * immediately rather than after a slow upload that ends in a 413. One definition,
 * two enforcement points; the server one is the one that matters.
 */

/** 2 MB. A logo that needs more than this is a photograph, not a logo. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024

export type LogoFormat = {
  mime: string
  extension: string
}

/**
 * The formats accepted, and the one that is deliberately not.
 *
 * **SVG is rejected.** It is the format a designer will hand a merchant, so this
 * costs something real, and it is still correct: an SVG is a document, it can
 * carry `<script>`, and this file is served from our own origin to be embedded
 * in wallet passes and email. Serving merchant-supplied markup inline from the
 * application origin is stored cross-site scripting with extra steps, and
 * `X-Content-Type-Options` does not help because the declared type is already
 * `image/svg+xml`. Neither Apple Wallet nor Google Wallet accepts SVG anyway, so
 * a merchant who uploaded one would have had it silently dropped from the exact
 * surface they were trying to brand.
 */
export const LOGO_FORMATS: readonly LogoFormat[] = [
  { mime: 'image/png', extension: 'png' },
  { mime: 'image/jpeg', extension: 'jpg' },
  { mime: 'image/webp', extension: 'webp' },
]

export const LOGO_ACCEPT = LOGO_FORMATS.map((format) => format.mime).join(',')

/**
 * Identifies an image by its bytes.
 *
 * The declared `Content-Type` on a multipart part is whatever the client chose
 * to write, so it is a hint and never a decision. Sniffing the magic number is
 * what stops an HTML file arriving labelled `image/png` and later being served
 * back with that type.
 */
export function sniffImageFormat(bytes: Uint8Array): LogoFormat | null {
  if (bytes.length < 12) return null

  const at = (index: number) => bytes[index]

  // PNG — \x89 P N G \r \n \x1a \n
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  ) {
    return { mime: 'image/png', extension: 'png' }
  }

  // JPEG — SOI marker.
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return { mime: 'image/jpeg', extension: 'jpg' }
  }

  // WebP — RIFF <size> WEBP
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...Array.from(bytes.slice(start, start + length)))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    return { mime: 'image/webp', extension: 'webp' }
  }

  return null
}

/** Why an upload was refused, as a code the UI translates. */
export type LogoRejection = 'empty' | 'too_large' | 'unsupported_format'

export type LogoCheck =
  | { ok: true; format: LogoFormat }
  | { ok: false; reason: LogoRejection }

export function checkLogo(bytes: Uint8Array): LogoCheck {
  if (bytes.byteLength === 0) return { ok: false, reason: 'empty' }
  if (bytes.byteLength > MAX_LOGO_BYTES) return { ok: false, reason: 'too_large' }

  const format = sniffImageFormat(bytes)
  if (!format) return { ok: false, reason: 'unsupported_format' }

  return { ok: true, format }
}
