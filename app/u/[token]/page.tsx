'use client'

import * as React from 'react'
import { use } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiGet, apiPost } from '@/lib/client/api'

type Info = {
  business: { name: string; logo_url: string | null }
  email: string
  consents: { email: boolean; sms: boolean; whatsapp: boolean; push: boolean }
}

/**
 * Unsubscribe landing page.
 *
 * Offers "fewer emails" alongside "no emails": a granular choice keeps far more
 * people on the list than an all-or-nothing button, and it is what regulators
 * and inbox providers expect from a bulk sender.
 */
export default function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [info, setInfo] = React.useState<Info | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [done, setDone] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    apiGet<Info>(`/api/v1/public/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch(() => setError('This link is invalid or has expired.'))
  }, [token])

  async function unsubscribe(channel: 'email' | 'all') {
    setBusy(true)
    try {
      await apiPost('/api/v1/public/unsubscribe', { token, channel })
      setDone(
        channel === 'all'
          ? 'You will not receive any more messages from this business.'
          : 'You have been removed from marketing emails.'
      )
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <p className="max-w-xs text-sm text-muted-foreground">{error}</p>
      </main>
    )
  }

  if (!info) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center">
        {done ? (
          <>
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-500 text-white">
              <Check className="size-6" />
            </div>
            <h1 className="mt-4 text-lg font-semibold">Done</h1>
            <p className="mt-2 text-sm text-muted-foreground">{done}</p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold">
              Unsubscribe from {info.business.name}?
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Messages are currently going to {info.email}.
            </p>
            <div className="mt-6 space-y-2">
              <Button
                variant="outline"
                className="h-11 w-full"
                disabled={busy}
                onClick={() => void unsubscribe('email')}
              >
                Stop marketing emails only
              </Button>
              <Button
                variant="destructive"
                className="h-11 w-full"
                disabled={busy}
                onClick={() => void unsubscribe('all')}
              >
                Stop all messages
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              You will still be able to use your loyalty card.
            </p>
          </>
        )}
      </div>
    </main>
  )
}
