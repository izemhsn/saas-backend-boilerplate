import pino from 'pino'

const isProd = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'
const logLevel = process.env.LOG_LEVEL ?? (isTest ? 'silent' : isProd ? 'info' : 'debug')

// Credential redaction — pino-http's default request serializer emits the
// whole `headers` object, which would write bearer tokens, API keys, cookies
// and Stripe webhook signatures to the log aggregator in plaintext on every
// request. Anyone with log read access could then replay them, so scrub them
// before they are ever serialized.
// Exported so tests can assert the real production config (the logger itself
// is disabled under NODE_ENV=test, so its output can't be captured directly).
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'req.headers.cookie',
  'req.headers["stripe-signature"]',
  'res.headers["set-cookie"]',
]

export const REDACT_CENSOR = '[REDACTED]'

const logger = pino({
  level: logLevel,
  redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
  ...(isProd
    ? {
        // Production: JSON for log aggregation (Datadog, ELK, etc.)
        timestamp: pino.stdTimeFunctions.isoTime,
      }
    : isTest
      ? {
          // Test: silent — tests shouldn't produce log noise
          enabled: false,
        }
      : {
          // Development: pretty-printed for readability
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname',
            },
          },
        }),
})

export default logger
