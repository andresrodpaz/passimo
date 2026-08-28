/**
 * Structured JSON logging.
 *
 * One line per event so any log drain (Vercel, Datadog, Loki) can index it.
 * Values are scrubbed for well-known secret-shaped keys before serialisation so
 * a careless `logger.error('failed', { body })` can never leak a token.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const SENSITIVE_KEY = /(password|secret|token|api[_-]?key|authorization|cookie|signature|p8|pem)/i
const MAX_DEPTH = 5

function minLevel(): number {
  const configured = (process.env.LOG_LEVEL ?? '').toLowerCase() as LogLevel
  if (configured in LEVEL_WEIGHT) return LEVEL_WEIGHT[configured]
  return process.env.NODE_ENV === 'production' ? LEVEL_WEIGHT.info : LEVEL_WEIGHT.debug
}

function scrub(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (depth >= MAX_DEPTH) return '[truncated]'
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrub(item, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : scrub(item, depth + 1)
    }
    return out
  }
  if (typeof value === 'string' && value.length > 2000) return `${value.slice(0, 2000)}…`
  return value
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>) {
  if (LEVEL_WEIGHT[level] < minLevel()) return
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...(context ? (scrub(context) as Record<string, unknown>) : {}),
  })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export type Logger = {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
  child(bindings: Record<string, unknown>): Logger
}

function build(bindings: Record<string, unknown>): Logger {
  const merge = (context?: Record<string, unknown>) => ({ ...bindings, ...context })
  return {
    debug: (m, c) => emit('debug', m, merge(c)),
    info: (m, c) => emit('info', m, merge(c)),
    warn: (m, c) => emit('warn', m, merge(c)),
    error: (m, c) => emit('error', m, merge(c)),
    child: (extra) => build({ ...bindings, ...extra }),
  }
}

export const logger: Logger = build({})
