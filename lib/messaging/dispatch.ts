import 'server-only'
import { getDb } from '@/lib/db'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { signToken } from '@/lib/crypto'
import { providerFor } from '@/lib/messaging/providers'
import { renderTemplate, truncateForChannel, type TemplateContext } from '@/lib/messaging/template'
import { emailBrandFromRow, renderBrandedEmail } from '@/lib/messaging/email-layout'
import { resolveLocale } from '@/lib/i18n/locales'
import { createTranslator } from '@/lib/i18n/translate'
import { trackUsage } from '@/lib/billing/entitlements'
import { num, type Channel } from '@/lib/domain/types'
import { realEmailOrNull } from '@/lib/customers/placeholder-email'

/**
 * The single exit point for every outbound customer message.
 *
 * Nothing bypasses it, because every reason a message must *not* be sent lives
 * here: consent, suppression lists, quiet hours, frequency caps, and channel
 * availability. Campaign code and automation code stay free of compliance
 * logic, and a new send path cannot accidentally omit a check.
 */

export type DispatchRequest = {
  businessId: string
  customerId: string
  /** `auto` picks the best channel the customer is reachable on. */
  channel: Channel | 'auto'
  /** Built-in or business template key; overridden by `subject`/`body`. */
  templateKey?: string | null
  subject?: string | null
  body?: string | null
  html?: string | null
  url?: string | null
  campaignId?: string | null
  automationId?: string | null
  automationRunId?: string | null
  /** Marketing messages honour consent + quiet hours; transactional ones do not. */
  category?: 'marketing' | 'transactional'
  idempotencyKey?: string | null
  extraContext?: TemplateContext
}

export type DispatchOutcome = {
  sent: boolean
  channel: Channel | null
  messageId: string | null
  skipReason?: string
  error?: string
}

/** Order tried when the caller asks for `auto`: reach, cost, then intrusiveness. */
const AUTO_CHANNEL_ORDER: Channel[] = ['wallet', 'email', 'whatsapp', 'sms']

export async function dispatchMessage(request: DispatchRequest): Promise<DispatchOutcome> {
  const admin = getDb()
  const category = request.category ?? 'marketing'

  const context = await loadDispatchContext(request.businessId, request.customerId)
  if (!context) return skip(request, 'customer_not_found')
  const { customer, business } = context

  if (customer.status !== 'active') return skip(request, 'customer_inactive')

  const channels =
    request.channel === 'auto'
      ? AUTO_CHANNEL_ORDER
      : [request.channel as Channel]

  const attemptedSkips: string[] = []

  for (const channel of channels) {
    const provider = providerFor(channel)
    if (!provider?.isConfigured()) {
      attemptedSkips.push(`${channel}:not_configured`)
      continue
    }

    const destination = destinationFor(channel, customer)
    if (!destination) {
      attemptedSkips.push(`${channel}:no_destination`)
      continue
    }

    if (category === 'marketing') {
      if (!hasConsent(channel, customer)) {
        attemptedSkips.push(`${channel}:no_consent`)
        continue
      }
      if (await isSuppressed(request.businessId, channel, destination)) {
        attemptedSkips.push(`${channel}:suppressed`)
        continue
      }
      const cap = await frequencyCapReached(request.businessId, request.customerId, business)
      if (cap) {
        attemptedSkips.push(`${channel}:frequency_cap`)
        continue
      }
      const quiet = quietHoursDelay(business)
      if (quiet) {
        // Never wake a customer at 3am; the caller reschedules.
        return skip(request, `quiet_hours:${quiet}`)
      }
    }

    const rendered = await renderMessage(request, { customer, business }, channel)
    if (!rendered) {
      attemptedSkips.push(`${channel}:no_template`)
      continue
    }

    const { data: message, error: insertError } = await admin
      .from('messages')
      .insert({
        business_id: request.businessId,
        customer_id: request.customerId,
        campaign_id: request.campaignId ?? null,
        automation_id: request.automationId ?? null,
        automation_run_id: request.automationRunId ?? null,
        channel,
        recipient: destination,
        subject: rendered.subject,
        body_preview: rendered.body.slice(0, 280),
        status: 'queued',
        provider: provider.name,
        idempotency_key: request.idempotencyKey ?? null,
      })
      .select('id')
      .maybeSingle()

    if (insertError) {
      // Unique violation on the idempotency key means this exact message was
      // already dispatched; treat the retry as a success, not a duplicate send.
      if (insertError.code === '23505') {
        return { sent: false, channel, messageId: null, skipReason: 'duplicate' }
      }
      logger.error('dispatch.message_insert_failed', { error: insertError })
      return { sent: false, channel, messageId: null, error: insertError.message }
    }

    const result = await provider.send({
      channel,
      to: destination,
      subject: rendered.subject,
      body: rendered.body,
      html: rendered.html,
      url: rendered.url,
      metadata: {
        customerId: request.customerId,
        unsubscribeUrl: rendered.unsubscribeUrl,
        locale: customer.locale ?? business.locale,
      },
    })

    await admin
      .from('messages')
      .update({
        status: result.ok ? 'sent' : 'failed',
        provider_message_id: result.providerMessageId ?? null,
        error: result.error ?? null,
        cost: result.cost,
        sent_at: result.ok ? new Date().toISOString() : null,
      })
      .eq('id', message!.id)

    if (result.ok) {
      if (request.campaignId) await bumpCampaignCounter(request.campaignId, 'sent_count')
      // Metered here rather than at each call site: this is the only place a
      // message is definitively sent, so the counter cannot drift from reality.
      void trackUsage(request.businessId, 'messages', 1)
      return { sent: true, channel, messageId: message!.id as string }
    }

    if (result.permanent) {
      await suppress(request.businessId, channel, destination, 'bounced', request.customerId)
    }
    if (request.campaignId) await bumpCampaignCounter(request.campaignId, 'failed_count')
    attemptedSkips.push(`${channel}:${result.error ?? 'send_failed'}`)
  }

  return skip(request, attemptedSkips.join(', ') || 'no_channel_available')
}

// -----------------------------------------------------------------------------
// Context
// -----------------------------------------------------------------------------

type DispatchCustomer = {
  id: string
  email: string | null
  phone: string | null
  name: string | null
  first_name: string | null
  locale: string | null
  status: string
  consent_email: boolean
  consent_sms: boolean
  consent_whatsapp: boolean
  consent_push: boolean
  consent_marketing: boolean
  last_visit: string | null
  apple_push_token: string | null
  birthday: string | null
}

type DispatchBusiness = {
  id: string
  name: string
  slug: string
  locale: string
  timezone: string
  primary_color: string | null
  accent_color: string | null
  logo_url: string | null
  google_review_url: string | null
  settings: Record<string, unknown>
}

async function loadDispatchContext(businessId: string, customerId: string) {
  const admin = getDb()
  const [customerResult, businessResult] = await Promise.all([
    admin
      .from('customers')
      .select(
        'id, email, phone, name, first_name, locale, status, consent_email, consent_sms, consent_whatsapp, consent_push, consent_marketing, last_visit, apple_push_token, birthday'
      )
      .eq('id', customerId)
      .eq('business_id', businessId)
      .maybeSingle(),
    admin
      .from('businesses')
      .select(
        'id, name, slug, locale, timezone, primary_color, accent_color, logo_url, google_review_url, settings'
      )
      .eq('id', businessId)
      .maybeSingle(),
  ])

  if (!customerResult.data || !businessResult.data) return null
  return {
    customer: customerResult.data as unknown as DispatchCustomer,
    business: businessResult.data as unknown as DispatchBusiness,
  }
}

function destinationFor(channel: Channel, customer: DispatchCustomer): string | null {
  switch (channel) {
    case 'email':
      return realEmailOrNull(customer.email)
    case 'sms':
    case 'whatsapp':
      return customer.phone
    case 'wallet':
    case 'push':
      return customer.apple_push_token ? customer.id : null
    default:
      return null
  }
}

function hasConsent(channel: Channel, customer: DispatchCustomer): boolean {
  switch (channel) {
    case 'email':
      return customer.consent_email
    case 'sms':
      return customer.consent_sms
    case 'whatsapp':
      return customer.consent_whatsapp
    case 'push':
    case 'wallet':
      // Installing the pass is the consent signal for wallet updates.
      return customer.consent_push
    default:
      return false
  }
}

async function isSuppressed(
  businessId: string,
  channel: Channel,
  destination: string
): Promise<boolean> {
  const admin = getDb()
  const { data } = await admin
    .from('suppressions')
    .select('id')
    .eq('business_id', businessId)
    .eq('destination', destination)
    .in('channel', [channel, 'all'])
    .maybeSingle()
  return Boolean(data)
}

export async function suppress(
  businessId: string,
  channel: Channel | 'all',
  destination: string,
  reason: 'unsubscribed' | 'bounced' | 'complained' | 'manual' | 'invalid',
  customerId?: string | null
): Promise<void> {
  const admin = getDb()
  await admin
    .from('suppressions')
    .upsert(
      {
        business_id: businessId,
        channel,
        destination,
        reason,
        customer_id: customerId ?? null,
      },
      { onConflict: 'business_id,channel,destination', ignoreDuplicates: true }
    )
}

/**
 * Frequency cap: how many marketing messages a customer may receive per week.
 * Over-messaging is the fastest way to destroy a loyalty list, so this defaults
 * to a conservative 3 and is merchant-configurable.
 */
async function frequencyCapReached(
  businessId: string,
  customerId: string,
  business: DispatchBusiness
): Promise<boolean> {
  const cap = num((business.settings as { weekly_message_cap?: number })?.weekly_message_cap, 3)
  if (cap <= 0) return false

  const admin = getDb()
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { count } = await admin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .gte('sent_at', since)
    .in('status', ['sent', 'delivered', 'opened', 'clicked'])

  return (count ?? 0) >= cap
}

/** Returns the reason string when we are inside the business's quiet hours. */
function quietHoursDelay(business: DispatchBusiness): string | null {
  const settings = business.settings as { quiet_hours?: { start?: string; end?: string } }
  const start = settings?.quiet_hours?.start ?? '21:00'
  const end = settings?.quiet_hours?.end ?? '09:00'

  const localHour = new Intl.DateTimeFormat('en-GB', {
    timeZone: business.timezone || 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())

  const inQuiet = start <= end ? localHour >= start && localHour < end : localHour >= start || localHour < end
  return inQuiet ? `${start}-${end}` : null
}

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------

type RenderedMessage = {
  subject: string | null
  body: string
  html: string | null
  url: string | null
  unsubscribeUrl: string | null
}

async function renderMessage(
  request: DispatchRequest,
  context: { customer: DispatchCustomer; business: DispatchBusiness },
  channel: Channel
): Promise<RenderedMessage | null> {
  const { customer, business } = context
  const locale = customer.locale ?? business.locale ?? 'es'

  let subject = request.subject ?? null
  let body = request.body ?? null

  if (!body && request.templateKey) {
    const template = await loadTemplate(request.businessId, request.templateKey, channel, locale)
    if (!template) return null
    subject ??= template.subject
    body = template.body
  }
  if (!body) return null

  const unsubscribeUrl =
    request.category === 'transactional'
      ? null
      : `${env.appUrl}/u/${signToken('unsubscribe', { c: customer.id, b: business.id }, 90 * 86_400)}`

  const templateContext: TemplateContext = {
    business_name: business.name,
    business_slug: business.slug,
    customer_name: customer.name ?? customer.first_name ?? '',
    customer_first_name: customer.first_name ?? customer.name?.split(' ')[0] ?? '',
    customer_email: customer.email ?? '',
    days_since_visit: customer.last_visit
      ? Math.floor((Date.now() - new Date(customer.last_visit).getTime()) / 86_400_000)
      : 0,
    card_url: `${env.appUrl}/card/${signToken('card', { c: customer.id }, 365 * 86_400)}`,
    review_url: business.google_review_url ?? '',
    unsubscribe_url: unsubscribeUrl ?? '',
    ...request.extraContext,
  }

  const renderedBody = truncateForChannel(renderTemplate(body, templateContext), channel)
  const renderedSubject = subject ? renderTemplate(subject, templateContext) : null
  const url = request.url ? renderTemplate(request.url, templateContext) : null

  // `locale` above is whatever the two rows happen to hold, which is not
  // necessarily a locale we ship a dictionary for.
  const shellLocale = resolveLocale(locale)
  const shellT = createTranslator(shellLocale)

  return {
    subject: renderedSubject,
    body: renderedBody,
    html:
      channel === 'email'
        ? (request.html
            ? renderTemplate(request.html, templateContext)
            : renderBrandedEmail({
                brand: emailBrandFromRow(business as unknown as Record<string, unknown>),
                // The *customer's* language when they have one, falling back to
                // the business's. Unlike the wallet card, this message has a
                // known recipient with a stated preference.
                locale: shellLocale,
                heading: renderedSubject ?? business.name,
                body: renderedBody,
                ctaLabel: url ? shellT('emails.shell.openCta') : null,
                ctaUrl: url,
                unsubscribeUrl,
              }))
        : null,
    url,
    unsubscribeUrl,
  }
}

async function loadTemplate(
  businessId: string,
  key: string,
  channel: Channel,
  locale: string
): Promise<{ subject: string | null; body: string } | null> {
  const admin = getDb()
  // Business override first, then the built-in for the locale, then English.
  const { data } = await admin
    .from('message_templates')
    .select('subject, body, business_id, locale')
    .eq('key', key)
    .eq('channel', channel)
    .eq('is_active', true)
    .or(`business_id.eq.${businessId},business_id.is.null`)
    .in('locale', [locale, 'en'])

  if (!data?.length) return null
  const ranked = [...data].sort((a, b) => {
    const ownership = Number(Boolean(b.business_id)) - Number(Boolean(a.business_id))
    if (ownership !== 0) return ownership
    return Number(b.locale === locale) - Number(a.locale === locale)
  })
  const chosen = ranked[0]!
  return { subject: (chosen.subject as string) ?? null, body: chosen.body as string }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function bumpCampaignCounter(campaignId: string, column: 'sent_count' | 'failed_count') {
  const admin = getDb()
  await admin.rpc('passimo_increment_campaign_counter', {
    p_campaign_id: campaignId,
    p_column: column,
  })
}

async function skip(request: DispatchRequest, reason: string): Promise<DispatchOutcome> {
  // Skips are recorded so merchants can see *why* an audience of 800 only
  // received 540 messages, instead of silently under-delivering.
  if (request.campaignId || request.automationRunId) {
    const admin = getDb()
    await admin.from('messages').insert({
      business_id: request.businessId,
      customer_id: request.customerId,
      campaign_id: request.campaignId ?? null,
      automation_id: request.automationId ?? null,
      automation_run_id: request.automationRunId ?? null,
      channel: request.channel === 'auto' ? 'email' : request.channel,
      recipient: '[skipped]',
      status: 'skipped',
      skip_reason: reason.slice(0, 500),
    })
  }
  return { sent: false, channel: null, messageId: null, skipReason: reason }
}
