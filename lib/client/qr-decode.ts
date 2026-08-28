'use client'

/**
 * Barcode decoding that works in every browser a merchant might already have.
 *
 * Hardware independence is a product invariant, and it is worth nothing if the
 * scanner only runs in Chrome. So decoding degrades in layers:
 *
 *   1. `BarcodeDetector` — Chrome, Edge, Android, Safari 17+. Hardware-backed,
 *      handles QR, PDF417 and the 1D formats on printed loyalty cards.
 *   2. A pure-JS QR decoder, loaded on demand — Firefox and older Safari.
 *   3. Manual entry, handled by the caller.
 *
 * The fallback is dynamically imported so the ~35 kB decoder is never downloaded
 * by the majority of merchants whose browser has the native API.
 */

export type DecodeEngine = 'native' | 'fallback'

/** Formats worth attempting: wallet passes plus printed cards merchants own. */
const NATIVE_FORMATS = [
  'qr_code',
  'pdf417',
  'aztec',
  'data_matrix',
  'code_128',
  'code_39',
  'ean_13',
  'ean_8',
  'itf',
  'upc_a',
  'upc_e',
] as const

type DetectedBarcode = { rawValue: string }

type BarcodeDetectorLike = {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}

type BarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): BarcodeDetectorLike
  getSupportedFormats?: () => Promise<string[]>
}

function nativeConstructor(): BarcodeDetectorConstructor | null {
  if (typeof window === 'undefined') return null
  return (
    (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector ?? null
  )
}

/** True when the browser can reach a camera at all. */
export function cameraSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    // A camera is unreachable outside a secure context, and failing early lets
    // the UI explain that instead of showing a bare permission error.
    (typeof window === 'undefined' || window.isSecureContext !== false)
  )
}

/**
 * Longest edge the JS fallback works on.
 *
 * A QR only needs a few pixels per module, and decode cost is quadratic in
 * resolution: 640 keeps a full-frame pass to a handful of milliseconds on a
 * mid-range phone, which is what allows continuous scanning without the device
 * getting hot behind a counter.
 */
const FALLBACK_MAX_EDGE = 640

export type QrDecoder = {
  /** Resolved after the first decode attempt. */
  engine: () => DecodeEngine | null
  decode: (source: HTMLVideoElement) => Promise<string | null>
  dispose: () => void
}

export function createQrDecoder(): QrDecoder {
  let native: BarcodeDetectorLike | null = null
  let nativeChecked = false
  let engine: DecodeEngine | null = null

  let canvas: HTMLCanvasElement | null = null
  let context: CanvasRenderingContext2D | null = null
  let fallback: typeof import('jsqr').default | null = null
  let fallbackLoading: Promise<void> | null = null

  /** Alternates full-frame and centre-crop passes; see `decodeWithFallback`. */
  let pass = 0

  async function ensureNative(): Promise<BarcodeDetectorLike | null> {
    if (nativeChecked) return native
    nativeChecked = true

    const Detector = nativeConstructor()
    if (!Detector) return null

    try {
      // A browser can expose the constructor and still not support QR — Chrome
      // on Linux historically did exactly that, so ask before trusting it.
      const supported = (await Detector.getSupportedFormats?.()) ?? null
      const formats = supported
        ? NATIVE_FORMATS.filter((format) => supported.includes(format))
        : [...NATIVE_FORMATS]
      if (supported && !formats.includes('qr_code')) return null

      native = new Detector({ formats })
      return native
    } catch {
      return null
    }
  }

  async function ensureFallback(): Promise<typeof import('jsqr').default | null> {
    if (fallback) return fallback
    fallbackLoading ??= import('jsqr')
      .then((module) => {
        fallback = module.default
      })
      .catch(() => {
        fallback = null
      })
    await fallbackLoading
    return fallback
  }

  function ensureCanvas(): CanvasRenderingContext2D | null {
    if (context) return context
    if (typeof document === 'undefined') return null
    canvas = document.createElement('canvas')
    // Signals to the browser that this canvas is read back every frame, which
    // keeps it off the GPU and avoids a stall per `getImageData`.
    context = canvas.getContext('2d', { willReadFrequently: true })
    return context
  }

  async function decodeWithFallback(video: HTMLVideoElement): Promise<string | null> {
    const decoder = await ensureFallback()
    const ctx = ensureCanvas()
    if (!decoder || !ctx || !canvas) return null

    const videoWidth = video.videoWidth
    const videoHeight = video.videoHeight
    if (!videoWidth || !videoHeight) return null

    // Two alternating passes rather than both every frame, so per-frame cost
    // stays predictable:
    //   - full frame catches a code held anywhere in view
    //   - a centre crop at higher effective resolution catches a small or
    //     distant code the downscaled full frame loses
    const useCrop = pass % 2 === 1
    pass += 1

    const cropFactor = useCrop ? 0.6 : 1
    const sourceWidth = Math.round(videoWidth * cropFactor)
    const sourceHeight = Math.round(videoHeight * cropFactor)
    const sourceX = Math.round((videoWidth - sourceWidth) / 2)
    const sourceY = Math.round((videoHeight - sourceHeight) / 2)

    const scale = Math.min(1, FALLBACK_MAX_EDGE / Math.max(sourceWidth, sourceHeight))
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale))
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale))

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth
      canvas.height = targetHeight
    }

    try {
      ctx.drawImage(
        video,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        targetWidth,
        targetHeight
      )
      const frame = ctx.getImageData(0, 0, targetWidth, targetHeight)
      const result = decoder(frame.data, frame.width, frame.height, {
        // Wallet passes in dark mode render light-on-dark, and some merchants
        // print inverted codes. Trying both costs little and fails less.
        inversionAttempts: 'attemptBoth',
      })
      return result?.data?.trim() || null
    } catch {
      // A cross-origin or not-yet-painted frame taints the canvas; the next
      // frame usually succeeds, so this is not worth surfacing.
      return null
    }
  }

  return {
    engine: () => engine,

    async decode(video) {
      if (video.readyState < 2 || video.videoWidth === 0) return null

      const detector = await ensureNative()
      if (detector) {
        try {
          const codes = await detector.detect(video)
          engine = 'native'
          const value = codes[0]?.rawValue?.trim()
          if (value) return value
          return null
        } catch {
          // Some builds throw per-frame under memory pressure rather than
          // failing construction. Give up on native and use the fallback for
          // the rest of the session instead of throwing away every frame.
          native = null
          nativeChecked = true
        }
      }

      engine = 'fallback'
      return decodeWithFallback(video)
    },

    dispose() {
      native = null
      fallback = null
      fallbackLoading = null
      context = null
      if (canvas) {
        // Releasing the backing store matters on iOS, which caps total canvas
        // memory per tab and will start failing draws silently.
        canvas.width = 0
        canvas.height = 0
        canvas = null
      }
    },
  }
}
