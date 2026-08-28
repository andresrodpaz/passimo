import type { Channel } from '@/lib/domain/types'

export type OutboundMessage = {
  channel: Channel
  /** Email address, E.164 phone, or device/wallet identifier. */
  to: string
  subject?: string | null
  /** Plain-text or templated body. */
  body: string
  html?: string | null
  /** Deep link appended to SMS/WhatsApp and used as the email CTA. */
  url?: string | null
  metadata?: Record<string, unknown>
}

export type SendResult = {
  ok: boolean
  providerMessageId?: string | null
  provider: string
  /** Estimated unit cost, used for campaign ROI. */
  cost: number
  error?: string
  /** True when the failure is permanent and the address should be suppressed. */
  permanent?: boolean
}

export interface ChannelProvider {
  readonly channel: Channel
  readonly name: string
  isConfigured(): boolean
  send(message: OutboundMessage): Promise<SendResult>
}

export function providerUnavailable(channel: Channel, provider: string): SendResult {
  return {
    ok: false,
    provider,
    cost: 0,
    error: `${channel} is not configured on this deployment`,
    permanent: false,
  }
}
