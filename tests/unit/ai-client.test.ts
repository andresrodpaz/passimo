import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The AI request shape, against a mocked provider.
 *
 * This file exists because of a defect that nothing else could have caught. Every
 * AI call sent `temperature`, which **Claude Sonnet 5 — the configured default
 * model — rejects with a 400**: sampling parameters were removed from that model
 * generation, so a non-default `temperature` is an invalid request rather than a
 * hint the model ignores.
 *
 * Three things conspired to hide it:
 *
 *  1. **No credential locally.** Without `ANTHROPIC_API_KEY` every call stops at
 *     `notConfigured` long before it reaches Anthropic, so the honest
 *     credential-absent behaviour the product is proud of was also what kept the
 *     bug invisible.
 *  2. **It was selective.** Four of the seven capabilities pass `fast: true` and
 *     run on Haiku 4.5, which still accepts `temperature`. Those worked. The three
 *     on the default model — campaign generation, the daily insight feed, program
 *     optimisation — would have failed on the first real request.
 *  3. **Nothing asserted the request.** The suite tested the *prompt builders* and
 *     the *schemas*, never the object handed to the SDK.
 *
 * So these tests mock the provider and assert the request shape. A mocked provider
 * is the right tool here: the question is not "what does the model answer?" but
 * "is this request valid for the model we configured?", and that is answerable
 * deterministically, offline, in CI, with no key.
 */

const create = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create }
  },
}))

const ORIGINAL_ENV = { ...process.env }

async function loadClient() {
  vi.resetModules()
  return import('@/lib/ai/client')
}

/** The request body the SDK was handed on the most recent call. */
function lastRequest(): Record<string, unknown> {
  expect(create, 'the provider was never called').toHaveBeenCalled()
  return create.mock.calls.at(-1)![0] as Record<string, unknown>
}

function textReply(text: string) {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn' }
}

function toolReply(name: string, input: unknown) {
  return {
    content: [{ type: 'tool_use', id: 'toolu_1', name, input }],
    stop_reason: 'tool_use',
  }
}

beforeEach(() => {
  create.mockReset()
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-not-real'
  delete process.env.ANTHROPIC_MODEL
  delete process.env.ANTHROPIC_FAST_MODEL
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('AI request shape', () => {
  it('never sends a sampling parameter, on either model', async () => {
    /*
     * The regression, stated as the invariant rather than as the symptom.
     * `temperature`, `top_p` and `top_k` are all rejected by the default model;
     * asserting their absence catches a reintroduction of any of the three,
     * including one added "just for the fast model" that later gets reused.
     */
    const { generateText, generateStructured } = await loadClient()

    create.mockResolvedValue(textReply('ok'))
    await generateText({ system: 's', prompt: 'p' })
    expect(lastRequest()).not.toHaveProperty('temperature')
    expect(lastRequest()).not.toHaveProperty('top_p')
    expect(lastRequest()).not.toHaveProperty('top_k')

    await generateText({ system: 's', prompt: 'p', fast: true })
    expect(lastRequest()).not.toHaveProperty('temperature')

    create.mockResolvedValue(toolReply('t', { ok: true }))
    await generateStructured({
      system: 's',
      prompt: 'p',
      schema: { type: 'object' },
      toolName: 't',
      toolDescription: 'd',
    })
    expect(lastRequest()).not.toHaveProperty('temperature')
  })

  it('opts out of thinking on the model where it is on by default', async () => {
    /*
     * On Claude Sonnet 5 a request that omits `thinking` thinks anyway, and
     * `max_tokens` caps thinking *plus* the answer. These calls are short and
     * several force a tool call, so an unbounded think can consume the budget and
     * return no tool block at all — which surfaces as a schema error rather than
     * as the truncation it is.
     */
    const { generateStructured } = await loadClient()
    create.mockResolvedValue(toolReply('t', { ok: true }))

    await generateStructured({
      system: 's',
      prompt: 'p',
      schema: { type: 'object' },
      toolName: 't',
      toolDescription: 'd',
    })

    expect(lastRequest().model).toBe('claude-sonnet-5')
    expect(lastRequest().thinking).toEqual({ type: 'disabled' })
  })

  it('omits thinking entirely on the fast model, which predates the field', async () => {
    /*
     * Haiku 4.5 does not think unless given a `budget_tokens`, so the correct
     * request omits the field rather than sending a disable it may not recognise.
     * Sending one shape to both models is how a fix for one becomes a 400 on the
     * other.
     */
    const { generateText } = await loadClient()
    create.mockResolvedValue(textReply('ok'))

    await generateText({ system: 's', prompt: 'p', fast: true })

    expect(String(lastRequest().model)).toMatch(/^claude-haiku-4-5/)
    expect(lastRequest()).not.toHaveProperty('thinking')
  })

  it('sends the smallest possible request for an unrecognised model', async () => {
    /*
     * `ANTHROPIC_MODEL` is deployment configuration, so an operator can point this
     * at something the traits table has never heard of. The conservative default
     * is the minimal request — model, tokens, system, messages — because that is
     * the shape most likely to be valid on a model nobody has characterised.
     */
    process.env.ANTHROPIC_MODEL = 'some-future-model-v9'
    const { generateText } = await loadClient()
    create.mockResolvedValue(textReply('ok'))

    await generateText({ system: 's', prompt: 'p' })

    const request = lastRequest()
    expect(request.model).toBe('some-future-model-v9')
    expect(request).not.toHaveProperty('thinking')
    expect(request).not.toHaveProperty('temperature')
    expect(Object.keys(request).sort()).toEqual(['max_tokens', 'messages', 'model', 'system'])
  })

  it('forces the tool call, so structured output cannot come back as prose', async () => {
    const { generateStructured } = await loadClient()
    create.mockResolvedValue(toolReply('propose_campaign', { name: 'Win-back' }))

    await generateStructured({
      system: 's',
      prompt: 'p',
      schema: { type: 'object', properties: { name: { type: 'string' } } },
      toolName: 'propose_campaign',
      toolDescription: 'd',
    })

    const request = lastRequest()
    expect(request.tool_choice).toEqual({ type: 'tool', name: 'propose_campaign' })
    expect(request.tools).toHaveLength(1)
  })

  it('validates the tool input rather than trusting it', async () => {
    // AI output is never application state. A validator that throws must
    // propagate, not be swallowed into a half-populated object.
    const { generateStructured } = await loadClient()
    create.mockResolvedValue(toolReply('t', { unexpected: 'shape' }))

    await expect(
      generateStructured({
        system: 's',
        prompt: 'p',
        schema: { type: 'object' },
        toolName: 't',
        toolDescription: 'd',
        validate: () => {
          throw new Error('schema mismatch')
        },
      })
    ).rejects.toThrow(/Anthropic/)
  })

  it('names the stop reason when the model returns no tool call', async () => {
    /*
     * "Model did not return structured output" sent the last person reading it to
     * look at the schema, when the actual cause is usually the token budget. The
     * stop reason distinguishes the two, and it belongs in the message.
     */
    const { generateStructured } = await loadClient()
    create.mockResolvedValue({ content: [{ type: 'text', text: 'sorry' }], stop_reason: 'max_tokens' })

    const error = await generateStructured({
      system: 's',
      prompt: 'p',
      schema: { type: 'object' },
      toolName: 't',
      toolDescription: 'd',
    }).catch((cause: unknown) => cause)

    expect(String(error)).toMatch(/max_tokens/)
  })
})

describe('credential-absent behaviour', () => {
  it('refuses honestly with no key, and never calls the provider', async () => {
    /*
     * The product's stated contract: AI architecture exists, credential is
     * missing, so the answer is `not_configured` — never a fabricated response and
     * never a silent fallback to static content.
     */
    delete process.env.ANTHROPIC_API_KEY
    const { generateText, aiAvailable } = await loadClient()

    expect(aiAvailable()).toBe(false)
    await expect(generateText({ system: 's', prompt: 'p' })).rejects.toMatchObject({
      code: 'not_configured',
    })
    expect(create, 'no provider call may be attempted without a key').not.toHaveBeenCalled()
  })

  it('reports availability from the credential, not from a flag somebody can set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-not-real'
    const { aiAvailable } = await loadClient()
    expect(aiAvailable()).toBe(true)
  })
})
