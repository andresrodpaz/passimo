import 'server-only'
import { Resend } from 'resend'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import type { ChannelProvider, OutboundMessage, SendResult } from '@/lib/messaging/types'
import { providerUnavailable } from '@/lib/messaging/types'
import { getDb } from '@/lib/db'
import { walletService } from '@/lib/wallet/service'

/**
 * Channel providers.
 *
 * Each provider is a thin, replaceable adapter behind one interface, so adding
 * a channel (or swapping Twilio for MessageBird) touches exactly one file and
 * the dispatcher does not change. Providers never throw: a failure is a
 * `SendResult` so the caller can record it, classify it and retry.
 */

// -----------------------------------------------------------------------------
// Email — Resend
// -----------------------------------------------------------------------------

let resendClient: Resend | null = null

function resend(): Resend | null {
  const key = env.email.apiKey
  if (!key) return null
  resendClient ??= new Resend(key)
  return resendClient
}

export const emailProvider: ChannelProvider = {
  channel: 'email',
  name: 'resend',
  isConfigured: () => Boolean(env.email.apiKey),
  async send(message: OutboundMessage): Promise<SendResult> {
    const client = resend()
    if (!client) return providerUnavailable('email', 'resend')

    try {
      const { data, error } = await client.emails.send({
        from: env.email.from,
        to: message.to,
        subject: message.subject ?? 'Message',
        html: message.html ?? `<p>${escapeHtml(message.body)}</p>`,
        text: message.body,
        ...(env.email.replyTo ? { replyTo: env.email.replyTo } : {}),
        headers: {
          // One-click unsubscribe is a Gmail/Yahoo bulk-sender requirement and
          // materially protects deliverability.
          ...(message.metadata?.unsubscribeUrl
            ? {
                'List-Unsubscribe': `<${message.metadata.unsubscribeUrl as string}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              }
            : {}),
        },
      })

      if (error) {
        return {
          ok: false,
          provider: 'resend',
          cost: 0,
          error: error.message,
          permanent: /invalid|not a valid|does not exist/i.test(error.message ?? ''),
        }
      }
      return { ok: true, provider: 'resend', providerMessageId: data?.id ?? null, cost: 0.0004 }
    } catch (cause) {
      logger.error('messaging.email_failed', { cause })
      return { ok: false, provider: 'resend', cost: 0, error: errorMessage(cause) }
    }
  },
}

// -----------------------------------------------------------------------------
// SMS — Twilio (REST, no SDK: one endpoint, avoids a heavy dependency)
// -----------------------------------------------------------------------------

export const smsProvider: ChannelProvider = {
  channel: 'sms',
  name: 'twilio',
  isConfigured: () => Boolean(env.sms.accountSid && env.sms.authToken && env.sms.from),
  async send(message: OutboundMessage): Promise<SendResult> {
    const sid = env.sms.accountSid
    const token = env.sms.authToken
    const from = env.sms.from
    if (!sid || !token || !from) return providerUnavailable('sms', 'twilio')

    const body = message.url ? `${message.body} ${message.url}` : message.body

    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: message.to, From: from, Body: body }),
        }
      )

      const payload = (await response.json()) as { sid?: string; message?: string; code?: number }
      if (!response.ok) {
        return {
          ok: false,
          provider: 'twilio',
          cost: 0,
          error: payload.message ?? `HTTP ${response.status}`,
          // 21211 invalid number, 21610 unsubscribed — never retry these.
          permanent: payload.code === 21211 || payload.code === 21610,
        }
      }
      // Roughly one segment of a Spanish/EU SMS.
      return { ok: true, provider: 'twilio', providerMessageId: payload.sid ?? null, cost: 0.045 }
    } catch (cause) {
      logger.error('messaging.sms_failed', { cause })
      return { ok: false, provider: 'twilio', cost: 0, error: errorMessage(cause) }
    }
  },
}

// -----------------------------------------------------------------------------
// WhatsApp — Meta Cloud API
// -----------------------------------------------------------------------------

export const whatsappProvider: ChannelProvider = {
  channel: 'whatsapp',
  name: 'meta',
  isConfigured: () => Boolean(env.whatsapp.phoneNumberId && env.whatsapp.accessToken),
  async send(message: OutboundMessage): Promise<SendResult> {
    const phoneNumberId = env.whatsapp.phoneNumberId
    const accessToken = env.whatsapp.accessToken
    if (!phoneNumberId || !accessToken) return providerUnavailable('whatsapp', 'meta')

    const templateName = message.metadata?.whatsappTemplate as string | undefined
    const body = message.url ? `${message.body}\n${message.url}` : message.body

    // Outside the 24-hour customer service window Meta only accepts approved
    // templates; marketing sends therefore always go out as templates.
    const payload = templateName
      ? {
          messaging_product: 'whatsapp',
          to: message.to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: (message.metadata?.locale as string) ?? 'es' },
            components: [
              {
                type: 'body',
                parameters: ((message.metadata?.templateParams as string[]) ?? [body]).map(
                  (text) => ({ type: 'text', text })
                ),
              },
            ],
          },
        }
      : {
          messaging_product: 'whatsapp',
          to: message.to,
          type: 'text',
          text: { preview_url: true, body },
        }

    try {
      const response = await fetch(
        `https://graph.facebook.com/${env.whatsapp.apiVersion}/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      )
      const result = (await response.json()) as {
        messages?: { id: string }[]
        error?: { message: string; code: number }
      }
      if (!response.ok || result.error) {
        return {
          ok: false,
          provider: 'meta',
          cost: 0,
          error: result.error?.message ?? `HTTP ${response.status}`,
          permanent: result.error?.code === 131026,
        }
      }
      return {
        ok: true,
        provider: 'meta',
        providerMessageId: result.messages?.[0]?.id ?? null,
        cost: 0.035,
      }
    } catch (cause) {
      logger.error('messaging.whatsapp_failed', { cause })
      return { ok: false, provider: 'meta', cost: 0, error: errorMessage(cause) }
    }
  },
}

// -----------------------------------------------------------------------------
// Wallet — an update pushed to the pass itself
//
// The highest-value channel we have: it is free, needs no consent (the customer
// installed the pass), and lands on the lock screen.
// -----------------------------------------------------------------------------

export const walletProvider: ChannelProvider = {
  channel: 'wallet',
  name: 'wallet',
  isConfigured: () => Boolean(env.apple.pushKeyP8 && env.apple.pushKeyId) || env.google.isConfigured,
  async send(message: OutboundMessage): Promise<SendResult> {
    const customerId = message.metadata?.customerId as string | undefined
    if (!customerId) {
      return { ok: false, provider: 'wallet', cost: 0, error: 'customerId required', permanent: true }
    }

    try {
      const admin = getDb()
      // The message becomes the pass back-field so it is visible when the
      // customer opens the card after the push wakes it.
      await admin
        .from('customers')
        .update({
          custom_fields: { last_wallet_message: message.body, at: new Date().toISOString() },
        })
        .eq('id', customerId)

      // The service reaches whichever wallets the customer actually installed;
      // pushing only to Apple silently dropped every Android member.
      const { delivered } = await walletService().notify({
        customerId,
        title: message.subject || 'Update to your card',
        message: message.body,
      })
      return delivered.length > 0
        ? { ok: true, provider: 'wallet', cost: 0 }
        : {
            ok: false,
            provider: 'wallet',
            cost: 0,
            error: 'no wallet pass installed',
            // Permanent: retrying will not make the customer install the card.
            permanent: true,
          }
    } catch (cause) {
      logger.error('messaging.wallet_failed', { cause })
      return { ok: false, provider: 'wallet', cost: 0, error: errorMessage(cause) }
    }
  },
}

// -----------------------------------------------------------------------------
// Web push — VAPID, no third party
// -----------------------------------------------------------------------------

export const pushProvider: ChannelProvider = {
  channel: 'push',
  name: 'webpush',
  isConfigured: () => Boolean(env.webPush.publicKey && env.webPush.privateKey),
  async send(message: OutboundMessage): Promise<SendResult> {
    if (!env.webPush.publicKey || !env.webPush.privateKey) {
      return providerUnavailable('push', 'webpush')
    }
    // Delivered through the wallet pass on iOS and the service worker on
    // Android/desktop; the wallet path covers the majority of our audience.
    return walletProvider.send({ ...message, channel: 'wallet' })
  },
}

const PROVIDERS: Record<string, ChannelProvider> = {
  email: emailProvider,
  sms: smsProvider,
  whatsapp: whatsappProvider,
  push: pushProvider,
  wallet: walletProvider,
}

export function providerFor(channel: string): ChannelProvider | null {
  return PROVIDERS[channel] ?? null
}

export function configuredChannels(): string[] {
  return Object.entries(PROVIDERS)
    .filter(([, provider]) => provider.isConfigured())
    .map(([channel]) => channel)
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
