import { defineRoute } from '@/lib/api/handler'
import {
  createRuleSchema,
  deleteRuleSchema,
  listRulesQuery,
  updateRuleSchema,
  payloadOf,
} from '@/lib/api/wallet-schemas'
import { recordAudit } from '@/lib/audit'
import { requireWithinLimit } from '@/lib/billing/entitlements'
import {
  archiveRule,
  createRule,
  listRules,
  updateRule,
  type RuleInput,
} from '@/lib/wallet/rule-store'
import {
  ACTION_LABELS,
  FACT_LABELS,
  OPERATOR_LABELS,
  RULE_ACTION_TYPES,
  RULE_FACTS,
  RULE_OPERATORS,
  describeRule,
} from '@/lib/wallet/rules'
import { WALLET_TEMPLATES, resolveWalletTemplate } from '@/lib/wallet/templates'
import { getTranslator } from '@/lib/i18n/server'

export const runtime = 'nodejs'

/**
 * The no-code automation rules behind the visual builder.
 *
 * The GET ships the rule *vocabulary* along with the rules: which facts can be
 * tested, which comparisons exist, which actions can be taken, and the human label
 * for each. That is what lets the builder be generated rather than hand-written,
 * so adding a fact to the engine adds it to the UI without a second edit — and
 * makes it impossible for the UI to offer a condition the evaluator cannot run.
 *
 * Every rule also comes back with `summary`: the sentence the merchant thought they
 * were writing, generated from the stored tree. If that sentence reads wrong, the
 * rule is wrong, which is the only way a no-code builder earns trust.
 */

export const GET = defineRoute(
  {
    name: 'wallet.rules.list',
    auth: 'required',
    query: listRulesQuery,
    businessIdFrom: { source: 'query', key: 'businessId' },
    permissions: ['wallet:read'],
    rateLimit: 'dashboard',
  },
  async ({ query, business }) => {
    const [rules, t] = await Promise.all([
      listRules(business.businessId, { activeOnly: query.activeOnly === 'true' }),
      getTranslator(),
    ])

    return {
      rules: rules.map((rule) => ({ ...rule, summary: describeRule(rule) })),
      vocabulary: {
        facts: RULE_FACTS.map((fact) => ({ value: fact, label: FACT_LABELS[fact] })),
        operators: RULE_OPERATORS.map((op) => ({ value: op, label: OPERATOR_LABELS[op] })),
        actions: RULE_ACTION_TYPES.map((type) => ({ value: type, label: ACTION_LABELS[type] })),
      },
      /* Preset rules a merchant can add with one click, from every template.
         Resolved in the viewer's language — this list is being read now. */
      presets: WALLET_TEMPLATES.flatMap((template) => {
        const resolved = resolveWalletTemplate(template, t)
        return resolved.rules.map((rule) => ({
          templateKey: rule.templateKey,
          industry: resolved.key,
          industryName: resolved.name,
          name: rule.name,
          description: rule.description,
          conditions: rule.conditions,
          actions: rule.actions,
          cooldownHours: rule.cooldownHours,
          summary: describeRule(rule),
        }))
      }).filter(
        (preset, index, all) =>
          all.findIndex((other) => other.templateKey === preset.templateKey) === index
      ),
    }
  }
)

export const POST = defineRoute(
  {
    name: 'wallet.rules.create',
    auth: 'required',
    body: createRuleSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['wallet:write'],
    feature: 'automation_rules',
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    if (body.isActive !== false) {
      await requireWithinLimit(business.businessId, 'automation_rules')
    }

    const rule = await createRule(
      business.businessId,
      payloadOf(body) as RuleInput,
      actor.id
    )

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'wallet.rule_created',
      resourceType: 'proximity_rule',
      resourceId: rule.id,
      summary: `Created rule "${rule.name}": ${describeRule(rule)}`,
      request,
    })

    return { rule: { ...rule, summary: describeRule(rule) } }
  }
)

export const PATCH = defineRoute(
  {
    name: 'wallet.rules.update',
    auth: 'required',
    body: updateRuleSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['wallet:write'],
    feature: 'automation_rules',
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    const input = payloadOf(body) as Partial<RuleInput>

    // Only enabling consumes the cap; disabling must always be possible.
    if (input.isActive === true) {
      await requireWithinLimit(business.businessId, 'automation_rules')
    }

    const rule = await updateRule(business.businessId, body.id, input)

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'wallet.rule_updated',
      resourceType: 'proximity_rule',
      resourceId: body.id,
      summary: `Updated rule "${rule.name}": ${describeRule(rule)}`,
      request,
    })

    return { rule: { ...rule, summary: describeRule(rule) } }
  }
)

export const DELETE = defineRoute(
  {
    name: 'wallet.rules.archive',
    auth: 'required',
    body: deleteRuleSchema,
    businessIdFrom: { source: 'body', key: 'businessId' },
    permissions: ['wallet:write'],
    rateLimit: 'dashboard',
  },
  async ({ body, business, actor, request }) => {
    await archiveRule(business.businessId, body.id)

    await recordAudit({
      businessId: business.businessId,
      actor,
      action: 'wallet.rule_archived',
      resourceType: 'proximity_rule',
      resourceId: body.id,
      summary: 'Archived an automation rule',
      request,
    })

    return { ok: true }
  }
)
