/**
 * Parser for the `select()` string shape the application uses.
 *
 * Two forms matter:
 *
 *   'id, name, created_at'                  plain columns
 *   'id, rewards:reward_id (name)'          an embedded related row
 *
 * The second form is the reason this file exists. It reads as "give me the
 * reward this redemption points at, nested under the key `rewards`", and it is
 * what lets a screen render a redemption with its reward name in one round trip.
 * `!inner` after the table name turns the join from optional into required,
 * which is how a filter on an embedded column ends up filtering the outer rows.
 *
 * Deliberately a small, strict parser rather than a permissive one: an
 * unrecognised select string throws at the call site during development instead
 * of quietly dropping a column at runtime.
 */

export type SelectColumn = {
  kind: 'column'
  /** Column on the base table, or `*`. */
  name: string
  /** Output key, when the call site aliased it. */
  alias: string | null
}

export type SelectEmbed = {
  kind: 'embed'
  /** Related table, and the key the nested value appears under. */
  table: string
  alias: string
  /** Explicit joining column on the base table, when given. */
  localColumn: string | null
  /** `!inner` — the base row is dropped when the related row is absent. */
  inner: boolean
  children: SelectNode[]
}

export type SelectNode = SelectColumn | SelectEmbed

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

class SelectParseError extends Error {
  constructor(message: string, source: string) {
    super(`Invalid select string (${message}): ${source}`)
    this.name = 'SelectParseError'
  }
}

/** Splits on commas that are not inside parentheses. */
function splitTopLevel(source: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''

  for (const char of source) {
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1

    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)

  if (depth !== 0) throw new SelectParseError('unbalanced parentheses', source)

  return parts.map((part) => part.trim()).filter((part) => part.length > 0)
}

function parseItem(raw: string, source: string): SelectNode {
  const parenIndex = raw.indexOf('(')

  if (parenIndex === -1) {
    // `alias:column` or plain `column` / `*`.
    const colonIndex = raw.indexOf(':')
    if (colonIndex === -1) {
      if (raw !== '*' && !IDENTIFIER.test(raw)) throw new SelectParseError(`bad column "${raw}"`, source)
      return { kind: 'column', name: raw, alias: null }
    }
    const alias = raw.slice(0, colonIndex).trim()
    const name = raw.slice(colonIndex + 1).trim()
    if (!IDENTIFIER.test(alias) || !IDENTIFIER.test(name)) {
      throw new SelectParseError(`bad alias "${raw}"`, source)
    }
    return { kind: 'column', name, alias }
  }

  if (!raw.endsWith(')')) throw new SelectParseError(`bad embed "${raw}"`, source)

  const head = raw.slice(0, parenIndex).trim()
  const body = raw.slice(parenIndex + 1, -1)

  let inner = false
  let spec = head

  const bangIndex = spec.indexOf('!')
  if (bangIndex !== -1) {
    const hint = spec.slice(bangIndex + 1).trim().toLowerCase()
    spec = spec.slice(0, bangIndex).trim()
    if (hint === 'inner') inner = true
    else if (hint !== 'left') {
      /*
       * PostgREST also accepts a constraint name here to disambiguate. This
       * layer disambiguates with the `table:column` form instead, which is what
       * every call site in the product uses, so an unrecognised hint is a typo
       * worth reporting rather than something to ignore.
       */
      throw new SelectParseError(`unsupported embed hint "!${hint}"`, source)
    }
  }

  let table = spec
  let localColumn: string | null = null

  const colonIndex = spec.indexOf(':')
  if (colonIndex !== -1) {
    table = spec.slice(0, colonIndex).trim()
    localColumn = spec.slice(colonIndex + 1).trim()
    if (!IDENTIFIER.test(localColumn)) throw new SelectParseError(`bad embed column "${raw}"`, source)
  }

  if (!IDENTIFIER.test(table)) throw new SelectParseError(`bad embed table "${raw}"`, source)

  const children = parseSelect(body)
  if (children.length === 0) throw new SelectParseError(`empty embed "${raw}"`, source)

  return { kind: 'embed', table, alias: table, localColumn, inner, children }
}

export function parseSelect(source: string): SelectNode[] {
  return splitTopLevel(source).map((item) => parseItem(item, source))
}

export function hasEmbeds(nodes: SelectNode[]): boolean {
  return nodes.some((node) => node.kind === 'embed')
}
