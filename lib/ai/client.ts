import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { notConfigured, upstreamFailed } from '@/lib/errors'

/**
 * Anthropic client wrapper.
 *
 * Two things matter here beyond "call the API":
 *  - **Structured output.** Every AI feature in the product renders into real
 *    UI (a prefilled campaign, a scored list), so we force a tool call with a
 *    JSON schema rather than parsing prose and hoping.
 *  - **Graceful degradation.** If no key is configured the product still works;
 *    AI surfaces simply say so instead of erroring the page.
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

export type GenerateOptions = {
  system: string
  prompt: string
  /** Use the fast model for cheap, high-volume tasks. */
  fast?: boolean
  maxTokens?: number
  temperature?: number
}

export async function generateText(options: GenerateOptions): Promise<string> {
  const model = options.fast ? env.ai.fastModel : env.ai.model
  try {
    const response = await anthropic().messages.create({
      model,
      max_tokens: options.maxTokens ?? 1500,
      temperature: options.temperature ?? 0.7,
      system: options.system,
      messages: [{ role: 'user', content: options.prompt }],
    })
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()
  } catch (cause) {
    logger.error('ai.generate_text_failed', { model, cause })
    throw upstreamFailed('Anthropic', cause)
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
      temperature: options.temperature ?? 0.4,
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
    })

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    )
    if (!toolUse) throw new Error('Model did not return structured output')

    return options.validate ? options.validate(toolUse.input) : (toolUse.input as T)
  } catch (cause) {
    logger.error('ai.generate_structured_failed', { model, tool: options.toolName, cause })
    throw upstreamFailed('Anthropic', cause)
  }
}
