'use client'

import * as React from 'react'
import { cameraSupported, createQrDecoder, type DecodeEngine } from '@/lib/client/qr-decode'

/**
 * The camera scanner behind the counter.
 *
 * Built for continuous use: the camera opens once and stays open while customer
 * after customer is served. Everything here exists because of something that
 * happens in a real shop —
 *
 *   - the same card gets read 30 times a second, so repeats are suppressed
 *   - the phone gets locked or the app backgrounded, so the stream is released
 *     and silently restored
 *   - a browser or OS can drop a camera track (another app grabs it, a tablet
 *     wakes from sleep), so an ended track restarts instead of appearing frozen
 *   - the counter is dim, so torch control is exposed where the device has it
 *   - the operator is not looking at the screen, so a scan confirms by sound and
 *     vibration as well as visually
 *
 * Decoding is throttled well below the display refresh rate: a QR does not
 * appear and vanish inside 80 ms, and scanning at 60 fps only heats the device
 * and flattens its battery halfway through a shift.
 */

const DECODE_INTERVAL_MS = 80

export type ScannerStatus =
  | 'idle'
  | 'starting'
  /** Camera live and decoding. */
  | 'scanning'
  /** Stream released because the tab is hidden; resumes automatically. */
  | 'suspended'
  | 'error'

export type ScannerError = {
  code: 'unsupported' | 'insecure' | 'denied' | 'not_found' | 'in_use' | 'unknown'
  message: string
}

export type QrScanner = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  status: ScannerStatus
  /** True while the camera is live, including between reads. */
  active: boolean
  supported: boolean
  error: ScannerError | null
  /** Which decoder actually ran; useful in support conversations. */
  engine: DecodeEngine | null
  start: () => Promise<void>
  stop: () => void
  /** Torch state; `canToggleTorch` is false where the device has no torch. */
  torchOn: boolean
  canToggleTorch: boolean
  toggleTorch: () => Promise<void>
  /** More than one camera present (front/rear, or a multi-camera tablet). */
  canSwitchCamera: boolean
  switchCamera: () => Promise<void>
  /** Suppress the same code until it has been away from the lens. */
  resetCooldown: () => void
}

export function useQrScanner({
  onResult,
  /**
   * Ignore a repeat of the same code inside this window. Long enough that a card
   * left in front of the lens is not read twice, short enough that two people
   * with the same code in a row still both get served.
   */
  cooldownMs = 3000,
  /** Audio confirmation. Off by default: some counters are quiet rooms. */
  sound = false,
  /** Pause decoding without releasing the camera, e.g. while a result shows. */
  paused = false,
}: {
  onResult: (value: string, meta: { decodeMs: number; engine: DecodeEngine | null }) => void
  cooldownMs?: number
  sound?: boolean
  paused?: boolean
}): QrScanner {
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const decoderRef = React.useRef<ReturnType<typeof createQrDecoder> | null>(null)
  const lastResultRef = React.useRef<{ value: string; at: number } | null>(null)
  const facingRef = React.useRef<'environment' | 'user'>('environment')
  const runningRef = React.useRef(false)
  /** True only while *we* released the camera for a hidden tab. */
  const suspendedRef = React.useRef(false)
  /**
   * The decode loop needs to restart a dead camera, but restarting is built from
   * `begin`, which the loop is started by. A ref breaks the cycle without making
   * any of it depend on render order.
   */
  const restartRef = React.useRef<(() => void) | null>(null)

  // Read through refs so a changing callback never forces the camera to restart.
  const onResultRef = React.useRef(onResult)
  const pausedRef = React.useRef(paused)
  const soundRef = React.useRef(sound)
  const cooldownRef = React.useRef(cooldownMs)

  const [status, setStatus] = React.useState<ScannerStatus>('idle')
  const [error, setError] = React.useState<ScannerError | null>(null)
  const [engine, setEngine] = React.useState<DecodeEngine | null>(null)
  const [torchOn, setTorchOn] = React.useState(false)
  const [canToggleTorch, setCanToggleTorch] = React.useState(false)
  const [canSwitchCamera, setCanSwitchCamera] = React.useState(false)

  React.useEffect(() => {
    onResultRef.current = onResult
  }, [onResult])
  React.useEffect(() => {
    pausedRef.current = paused
  }, [paused])
  React.useEffect(() => {
    soundRef.current = sound
  }, [sound])
  React.useEffect(() => {
    cooldownRef.current = cooldownMs
  }, [cooldownMs])

  // Feature detection is browser-only, so it is read through an external store
  // rather than an effect: no hydration mismatch, no second render.
  const supported = React.useSyncExternalStore(
    () => () => {},
    cameraSupported,
    () => false
  )

  const releaseStream = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    runningRef.current = false
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    const video = videoRef.current
    if (video) {
      video.srcObject = null
      // Without this, iOS Safari keeps the last frame painted and the operator
      // cannot tell a stopped camera from a frozen one.
      video.removeAttribute('src')
      video.load()
    }
    setTorchOn(false)
    setCanToggleTorch(false)
  }, [])

  const stop = React.useCallback(() => {
    releaseStream()
    suspendedRef.current = false
    decoderRef.current?.dispose()
    decoderRef.current = null
    setStatus('idle')
  }, [releaseStream])

  /**
   * The decode loop.
   *
   * Held in a ref and defined inside an effect rather than as a `useCallback`:
   * the loop reschedules itself, and a function declaration can legally do that
   * where a `const` arrow function cannot. It also keeps the loop identity fixed
   * for the life of the hook, so nothing it captures can go stale mid-shift.
   */
  const loopRef = React.useRef<() => void>(() => {})

  React.useEffect(() => {
    async function tick(): Promise<void> {
      if (!runningRef.current) return

      const video = videoRef.current
      const decoder = decoderRef.current

      if (video && decoder && !pausedRef.current) {
        // A track that ended while we were not looking (device sleep, another
        // app taking the camera) leaves a live-looking element showing nothing.
        const track = streamRef.current?.getVideoTracks()[0]
        if (track && track.readyState === 'ended') {
          runningRef.current = false
          restartRef.current?.()
          return
        }

        try {
          const startedAt = performance.now()
          const value = await decoder.decode(video)
          const currentEngine = decoder.engine()
          setEngine((previous) => (previous === currentEngine ? previous : currentEngine))

          if (value) {
            const last = lastResultRef.current
            const isRepeat = last?.value === value && Date.now() - last.at < cooldownRef.current
            // Either way the timestamp is refreshed, so a card left resting in
            // front of the lens stays suppressed rather than re-firing once per
            // cooldown window.
            lastResultRef.current = { value, at: Date.now() }
            if (!isRepeat) {
              confirmScan(soundRef.current)
              onResultRef.current(value, {
                decodeMs: Math.round(performance.now() - startedAt),
                engine: currentEngine,
              })
            }
          }
        } catch {
          // A single bad frame is normal; keep scanning.
        }
      }

      if (runningRef.current) {
        timerRef.current = setTimeout(() => void tick(), DECODE_INTERVAL_MS)
      }
    }

    loopRef.current = () => void tick()
  }, [])

  const begin = React.useCallback(
    async (facing: 'environment' | 'user') => {
      if (!cameraSupported()) {
        setStatus('error')
        setError(
          typeof window !== 'undefined' && window.isSecureContext === false
            ? {
                code: 'insecure',
                message: 'Cameras need a secure (https) connection. Open the site over https.',
              }
            : {
                code: 'unsupported',
                message: 'This browser cannot use the camera. Find the customer by name instead.',
              }
        )
        return
      }

      setStatus('starting')
      setError(null)

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            // `ideal`, never `exact`: a laptop with one webcam must still work.
            facingMode: { ideal: facing },
            // Enough resolution to read a phone screen at arm's length without
            // asking the device for a 4K buffer we immediately downscale.
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        })

        const video = videoRef.current
        if (!video) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream
        video.srcObject = stream
        // Required for autoplay on iOS; set here as well as in markup because a
        // remount can drop the attribute before the stream is attached.
        video.playsInline = true
        video.muted = true
        await video.play()

        const track = stream.getVideoTracks()[0]
        const capabilities = (
          track as MediaStreamTrack & { getCapabilities?: () => MediaTrackCapabilities }
        ).getCapabilities?.()
        setCanToggleTorch(Boolean((capabilities as { torch?: boolean } | undefined)?.torch))

        // Only offer a camera switch where switching means something.
        void navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            setCanSwitchCamera(devices.filter((d) => d.kind === 'videoinput').length > 1)
          })
          .catch(() => setCanSwitchCamera(false))

        decoderRef.current ??= createQrDecoder()
        facingRef.current = facing
        runningRef.current = true
        suspendedRef.current = false
        setStatus('scanning')
        timerRef.current = setTimeout(() => loopRef.current(), 0)
      } catch (cause) {
        releaseStream()
        setStatus('error')
        setError(describeCameraError(cause))
      }
    },
    [releaseStream]
  )

  const start = React.useCallback(() => begin(facingRef.current), [begin])

  /** Re-acquire the camera after a dropped track or a return from background. */
  React.useEffect(() => {
    restartRef.current = () => {
      releaseStream()
      void begin(facingRef.current)
    }
  }, [begin, releaseStream])

  const switchCamera = React.useCallback(async () => {
    const next = facingRef.current === 'environment' ? 'user' : 'environment'
    releaseStream()
    await begin(next)
  }, [begin, releaseStream])

  const toggleTorch = React.useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    try {
      await (
        track as MediaStreamTrack & {
          applyConstraints: (c: { advanced?: Array<{ torch: boolean }> }) => Promise<void>
        }
      ).applyConstraints({ advanced: [{ torch: next }] })
      setTorchOn(next)
    } catch {
      // Some devices advertise a torch and then refuse it; hide the control
      // rather than leaving a button that does nothing.
      setCanToggleTorch(false)
    }
  }, [torchOn])

  /**
   * Release the camera while the tab is hidden and take it back on return.
   *
   * A counter tablet spends much of the day with the screen off. Holding the
   * camera through that drains the battery, and iOS in particular hands back a
   * dead track when the page is restored — so a clean restart is both cheaper
   * and more reliable than trying to keep the stream alive.
   */
  React.useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        if (runningRef.current) {
          releaseStream()
          suspendedRef.current = true
          setStatus('suspended')
        }
        return
      }
      // Only resume what we suspended ourselves — never take the camera back
      // because the merchant happened to switch tabs.
      if (suspendedRef.current) {
        suspendedRef.current = false
        void begin(facingRef.current)
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [begin, releaseStream])

  // Always release the camera on unmount: an abandoned stream keeps the privacy
  // indicator lit, which merchants reasonably read as us spying on them.
  React.useEffect(
    () => () => {
      releaseStream()
      decoderRef.current?.dispose()
      decoderRef.current = null
    },
    [releaseStream]
  )

  return {
    videoRef,
    status,
    active: status === 'scanning',
    supported,
    error,
    engine,
    start,
    stop,
    torchOn,
    canToggleTorch,
    toggleTorch,
    canSwitchCamera,
    switchCamera,
    resetCooldown: () => {
      lastResultRef.current = null
    },
  }
}

// -----------------------------------------------------------------------------
// Feedback
// -----------------------------------------------------------------------------

let audioContext: AudioContext | null = null

/**
 * Confirms a read without the operator having to look at the screen.
 *
 * A short synthesised blip rather than an audio file: no asset to load, no
 * request to fail, and it works the first time on a cold cache. Vibration is
 * unconditional because it is silent and universally welcome.
 */
function confirmScan(sound: boolean): void {
  navigator.vibrate?.(40)
  if (!sound) return

  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return

    audioContext ??= new Ctor()
    // A context created before the first user gesture starts suspended.
    if (audioContext.state === 'suspended') void audioContext.resume()

    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = 1120
    // Ramp down instead of stopping abruptly, which clicks on some speakers.
    gain.gain.setValueAtTime(0.12, audioContext.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.12)
    oscillator.connect(gain).connect(audioContext.destination)
    oscillator.start()
    oscillator.stop(audioContext.currentTime + 0.13)
  } catch {
    // Audio is a nicety; never let it interrupt a scan.
  }
}

function describeCameraError(cause: unknown): ScannerError {
  const name = cause instanceof DOMException ? cause.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        code: 'denied',
        message:
          'Camera access was blocked. Allow the camera for this site in your browser settings, then try again.',
      }
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        code: 'not_found',
        message: 'No camera found on this device. Find the customer by name instead.',
      }
    case 'NotReadableError':
    case 'AbortError':
      return {
        code: 'in_use',
        message: 'Another app is using the camera. Close it and try again.',
      }
    default:
      return {
        code: 'unknown',
        message: 'The camera could not start. Find the customer by name instead.',
      }
  }
}
