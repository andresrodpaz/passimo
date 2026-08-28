import { defineRoute } from '@/lib/api/handler'
import { applyTemplateSchema } from '@/lib/api/wallet-schemas'
import { recordAudit } from '@/lib/audit'
import { notFound } from '@/lib/errors'
import { applyTemplateCampaigns } from '@/lib/wallet/campaigns'
import { applyTemplateRules } from '@/lib/wallet/rule-store'
import { applyTemplateSettings } from '@/lib/wallet/settings'
import { scheduleBusinessWalletSync } from '@/lib/wallet/sync'
import { WALLET_TEMPLATES, findTemplate, resolveWalletTemplate } from '@/lib/wallet/templates'
import { describeRule } from '@/lib/wallet/rules'
import { getTranslator } from '@/lib/i18n/server'

export const runtime = 'nodejs'

/**
 * Industry wallet strategies.
 *
 * A merchant who has just signed up knows they run a bakery; they do not know what
 * radius to use or what time a fresh-batch notification should fire. This turns
 * "I run a bakery" into a complete, sensible proximity setup in one click.
 *
 * What it creates are **ordinary rows the merchant then owns**. A template is a
 * starting point, never a binding: everything it writes is editable, and nothing
 * about it is remembered except which template was applied, for support.
 *
 * Campaigns and rules are created **paused**. A gallery button that immediately
 * starts pushing notifications to real customers is a support incident, not a
 * feature — the merchant has to read the copy that will reach their customers
 * before it reaches them.
 */

export const GET = defineRoute(
  {
    name: 'wallet.templates.list',
    auth: 'required',
    rateLimit: 'dashboard',
  },
  async () => {
    /*
     * The *viewer's* locale here, not the business's: this is a gallery being
     * read right now by whoever is signed in. The business's locale is what
     * matters at POST, where the copy stops being a preview and becomes rows a
     * customer will read.
     */
    const t = await getTranslator()

    return {
      templates: WALLET_TEMPLATES.map((template) => {
        const resolved = resolveWalletTemplate(template, t)
        return {
          key: resolved.key,
          name: resolved.name,
          summary: resolved.summary,
          emoji: resolved.emoji,
          settings: resolved.settings,
          campaigns: resolved.campaigns.map((campaign) => ({
            name: campaign.name,
            description: campaign.description,
            kind: campaign.kind,
            trigger: campaign.trigger,
            title: campaign.title,
            message: campaign.message,
            emoji: campaign.emoji,
            ctaLabel: campaign.ctaLabel,
            radiusMeters: campaign.radiusMeters ?? null,
            weekdays: campaign.weekdays ?? null,
            startTime: campaign.startTime ?? null,
            endTime: campaign.endTime ?? null,
          })),
          rules: resolved.rules.map((rule) => ({
            templateKey: rule.templateKey,
            name: rule.name,
            description: rule.description,
            summary: describeRule(rule),
          })),
        }
      }),
    }
  }
)

export const POST = defineRoute(
  {
    name: 'wallet.templates.apply',
    auth: 'required',
    body: applyTemplateSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['wallet:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    const template = findTemplate(body.templateKey)
    if (!template) throw notFound('Template')

    const include = body.include

    const settings = include.settings
      ? await applyTemplateSettings(business.businessId, template.key)
      : null

    /*
     * Campaigns and rules are gated by plan, but a template application must not
     * fail wholesale because one part is not included: a Starter merchant applying
     * "Coffee shop" should still get the radius and quiet hours that make their
     * pass behave sensibly.
     */
    const campaigns = include.campaigns
      ? await applyTemplateCampaigns(business.businessId, template.key, actor.id).catch(() => ({
          created: 0,
          skipped: 0,
          blocked: true as const,
        }))
      : { created: 0, skipped: 0 }

    const rules = include.rules
      ? await applyTemplateRules(business.businessId, template.key, actor.id).catch(() => ({
          created: 0,
          skipped: 0,
          blocked: true as const,
        }))
      : { created: 0, skipped: 0 }

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'wallet.template_applied',
      resourceType: 'business',
      resourceId: business.businessId,
      /*
       * The audit log names the template by *key*, not by its translated name.
       * An audit trail is read by operators reconstructing what happened, and a
       * row saying "Applied the Cafetería wallet strategy" is one that cannot be
       * grepped alongside its English sibling for the same action.
       */
      summary: `Applied wallet strategy ${template.key}: ${campaigns.created} campaigns, ${rules.created} rules`,
      request,
    })

    if (include.settings) {
      await scheduleBusinessWalletSync(business.businessId, 'campaign_applied')
    }

    return {
      template: { key: template.key },
      settings,
      campaigns,
      rules,
      /*
       * Counts, not a sentence. This route used to return an English string for
       * the client to display, which is a mixed-language bug waiting for the
       * first screen that renders it — the API has no view and therefore no
       * locale. The dashboard composes its own message from these numbers.
       */
      reviewRequired: campaigns.created + rules.created > 0,
    }
  }
)
