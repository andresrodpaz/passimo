import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { isAppError, notConfigured, upstreamFailed } from '@/lib/errors'

/**
 * Anthropic client wrapper.
 *
 * Three things matter here beyond "call the API":
 *  - **Structured output.** Every AI feature in the product renders into real
 *    UI (a prefilled campaign, a scored list), so we force a tool call with a
 *    JSON schema rather than parsing prose and hoping.
 *  - **Graceful degradation.** If no key is configured the product still works;
 *    AI surfaces simply say so instead of erroring the page.
 *  - **Model-parameter compatibility.** The request shape a model accepts is not
 *    the same across generations, and getting it wrong is a 400 rather than a
 *    degradation. `MODEL_TRAITS` below is the one place that knows the
 *    difference.
 */

let client: Anthropic | null = null

function anthropic(): Anthropic {
  const apiKey = env.ai.apiKey
  if (!apiKey) throw notConfigured('AI (ANTHROPIC_API_KEY)')
  client ??= new Anthropic({ apiKey, maxRetries: 2 })
  return client
}

export function aiAvailable(): boolean {
  return env.ai.isConfigured
}

/**
 * Per-model request-shape facts, because they are not uniform and the
 * differences are hard failures rather than quality differences.
 *
 * This existed as nothing, and the omission was a launch blocker: every call
 * sent `temperature`, which **Claude Sonnet 5 rejects with a 400**. Sampling
 * parameters were removed from the Sonnet 5 / Opus 4.7+ generation — a
 * non-default `temperature`, `top_p` or `top_k` is an invalid request, not a
 * hint the model ignores. Because only four of the seven capabilities pass
 * `fast: true`, the failure was also *selective*: the Haiku-backed ones
 * (segment builder, customer summary, feedback themes, copy rewrite) still
 * accepted `temperature` and worked, while campaign generation, the insight
 * feed and program optimisation — the three that run on the default model —
 * would have 400'd on the first real request. Nothing surfaced it locally
 * because no `ANTHROPIC_API_KEY` is configured, so every call stopped at
 * `notConfigured` long before it reached Anthropic.
 *
 * `thinkingOnByDefault` is the second half of the same problem. On Sonnet 5 a
 * request that omits `thinking` runs with **adaptive thinking**, and
 * `max_tokens` caps thinking *plus* response text together. These calls are
 * deliberately short (350–2,000 tokens) and several force a tool call, so
 * thinking could consume the budget and leave no `tool_use` block at all —
 * surfacing as "Model did not return structured output" rather than as a
 * truncation. Sending `{ type: 'disabled' }` keeps the behaviour the prompts
 * were written and tested against.
 *
 * Adding a model means adding a row. Verified against the Anthropic model
 * catalogue on 2026-09-08: `claude-sonnet-5` and `claude-haiku-4-5` are both
 * **active** — neither deprecated nor retired.
 */
type ModelTraits = {
  /**
   * True when omitting `thinking` means the model thinks anyway, so the short
   * bounded calls in this product have to opt out explicitly.
   */
  thinkingOnByDefault: boolean
  /**
   * True when the model accepts an explicit `thinking: { type: 'disabled' }`.
   * Haiku 4.5 predates that shape: it simply does not think unless given a
   * `budget_tokens`, so the correct request omits the field entirely rather
   * than sending a disable it may not recognise.
   */
  acceptsThinkingDisabled: boolean
}

const MODEL_TRAITS: Array<{ prefix: string; traits: ModelTraits }> = [
  // Claude Sonnet 5 — adaptive thinking on by default; sampling params rejected.
  { prefix: 'claude-sonnet-5', traits: { thinkingOnByDefault: true, acceptsThinkingDisabled: true } },
  // Claude Opus 5 — same, and thinking may only be disabled at effort `high` or
  // below. We send no `effort`, so the default (`high`) keeps that legal.
  { prefix: 'claude-opus-5', traits: { thinkingOnByDefault: true, acceptsThinkingDisabled: true } },
  { prefix: 'claude-opus-4-8', traits: { thinkingOnByDefault: false, acceptsThinkingDisabled: true } },
  { prefix: 'claude-opus-4-7', traits: { thinkingOnByDefault: false, acceptsThinkingDisabled: true } },
  // Claude Haiku 4.5 — no thinking unless asked; `effort` errors on this model,
  // which is why nothing here sends one.
  { prefix: 'claude-haiku-4-5', traits: { thinkingOnByDefault: false, acceptsThinkingDisabled: false } },
]

/**
 * Conservative default for a model nobody has characterised: assume it does not
 * think by default and does not accept the disable. That produces the smallest
 * possible request — model, tokens, system, messages — which is the shape most
 * likely to be valid on an unknown model.
 */
const DEFAULT_TRAITS: ModelTraits = {
  thinkingOnByDefault: false,
  acceptsThinkingDisabled: false,
}

function traitsFor(model: string): ModelTraits {
  return MODEL_TRAITS.find((entry) => model.startsWith(entry.prefix))?.traits ?? DEFAULT_TRAITS
}

/**
 * The `thinking` field for a model, or nothing.
 *
 * Only sent when the model both thinks by default *and* accepts being told not
 * to. Every other case omits the field, which is the shape that has always
 * worked.
 */
function thinkingFor(model: string): { thinking: { type: 'disabled' } } | Record<string, never> {
  const traits = traitsFor(model)
  return traits.thinkingOnByDefault && traits.acceptsThinkingDisabled
    ? { thinking: { type: 'disabled' as const } }
    : {}
}

export type GenerateOptions = {
  system: string
  prompt: string
  /** Use the fast model for cheap, high-volume tasks. */
  fast?: boolean
  maxTokens?: number
}

/*
 * `temperature` used to be an option here and is deliberately gone rather than
 * ignored. It is rejected outright by the default model, so an option that
 * silently 400s is worse than no option: the four capabilities that set it were
 * expressing a real intent (determinism for the segment compiler, a little
 * warmth for a customer summary), and that intent now belongs in the prompt,
 * which is where the current guidance puts it. Each affected prompt says
 * explicitly what it wants instead.
 */

/**
 * Turns a thrown value into the error the caller should actually see.
 *
 * The previous `catch` wrapped *everything* in `upstreamFailed('Anthropic')`,
 * which laundered two things worth keeping:
 *
 *  - **A missing credential became a fake provider outage.** `anthropic()`
 *    throws `notConfigured`, and because the call sat inside the `try` it came
 *    back out as `upstream_failed` — "Anthropic request failed" for a
 *    deployment that had simply never been given a key. The API routes happen
 *    to guard on `env.ai.isConfigured` first, so the documented
 *    `503 not_configured` behaviour survived at the edge; the library
 *    underneath it did not, which meant the contract held by luck and the next
 *    call site that forgot the guard would have reported an outage instead.
 *  - **Our own diagnostics were discarded.** `upstreamFailed` builds a fixed
 *    message and keeps the original only as `cause`, so the "no tool call
 *    (stop_reason: max_tokens)" message below never reached a log or a reader.
 *
 * An `AppError` is already a deliberate, classified error — pass it through.
 * Wrap only what came from the provider or the transport, which is what
 * `upstream_failed` is for.
 */
function asAiError(cause: unknown): unknown {
  return isAppError(cause) ? cause : upstreamFailed('Anthropic', cause)
}

export async function generateText(options: GenerateOptions): Promise<string> {
  const model = options.fast ? env.ai.fastModel : env.ai.model
  try {
    const response = await anthropic().messages.create({
      model,
      max_tokens: options.maxTokens ?? 1500,
      system: options.system,
      messages: [{ role: 'user', content: options.prompt }],
      ...thinkingFor(model),
    })
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()
  } catch (cause) {
    /*
     * Not logged at error when the deployment simply has no key: a missing
     * credential is a configuration fact, and paging on it trains people to
     * ignore the channel where real provider failures arrive.
     */
    if (isAppError(cause) && cause.code === 'not_configured') throw cause
    logger.error('ai.generate_text_failed', { model, cause })
    throw asAiError(cause)
  }
}

export type StructuredOptions<T> = GenerateOptions & {
  /** JSON Schema describing the object the model must return. */
  schema: Record<string, unknown>
  toolName: string
  toolDescription: string
  validate?: (value: unknown) => T
}

/**
 * Forces a single tool call so the result is a validated object, not prose.
 * This is what makes "generate a campaign" land as an editable draft rather
 * than a wall of text the merchant has to copy-paste.
 */
export async function generateStructured<T>(options: StructuredOptions<T>): Promise<T> {
  const model = options.fast ? env.ai.fastModel : env.ai.model
  try {
    const response = await anthropic().messages.create({
      model,
      max_tokens: options.maxTokens ?? 2000,
      system: options.system,
      messages: [{ role: 'user', content: options.prompt }],
      tools: [
        {
          name: options.toolName,
          description: options.toolDescription,
          input_schema: options.schema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: options.toolName },
      /*
       * Forced tool use plus a small `max_tokens` is exactly the combination
       * that makes default-on thinking dangerous: the budget is shared, and a
       * turn that spends it thinking returns no `tool_use` block at all.
       */
      ...thinkingFor(model),
    })

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    )
    if (!toolUse) {
      /*
       * Names the two things that actually cause this, because "did not return
       * structured output" on its own sent the last person reading it looking
       * at the schema. `stop_reason` distinguishes them: `max_tokens` means the
       * budget ran out, anything else means the model declined.
       */
      throw upstreamFailed(
        `Anthropic (no tool call, stop_reason: ${response.stop_reason ?? 'unknown'})`,
        response
      )
    }

    return options.validate ? options.validate(toolUse.input) : (toolUse.input as T)
  } catch (cause) {
    if (isAppError(cause) && cause.code === 'not_configured') throw cause
    logger.error('ai.generate_structured_failed', { model, tool: options.toolName, cause })
    throw asAiError(cause)
  }
}
