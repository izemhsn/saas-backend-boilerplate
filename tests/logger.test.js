import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { REDACT_PATHS, REDACT_CENSOR } from '../src/utils/logger.js'

// The application logger is disabled under NODE_ENV=test, so these tests build
// a fresh pino instance from the *same* exported redaction config and capture
// its output. That keeps the assertions tied to what production actually uses.
const captureLines = () => {
  const lines = []
  const stream = {
    write: (chunk) => {
      lines.push(JSON.parse(chunk))
    },
  }
  const logger = pino({ redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR } }, stream)
  return { logger, lines }
}

const ACCESS_TOKEN = 'Bearer eyJhbGciOiJIUzI1NiJ9.super-secret-payload.signature'
const API_KEY = 'fake-api-key-REDACT-ME-0123456789abcdef'
const COOKIE = 'session=do-not-log-me'
const STRIPE_SIG = 't=1234567890,v1=deadbeefcafe'

describe('logger credential redaction', () => {
  it('redacts credential headers from a request log record', () => {
    const { logger, lines } = captureLines()

    logger.info(
      {
        req: {
          method: 'GET',
          url: '/api/auth/me',
          headers: {
            authorization: ACCESS_TOKEN,
            'x-api-key': API_KEY,
            cookie: COOKIE,
            'stripe-signature': STRIPE_SIG,
          },
        },
      },
      'GET /api/auth/me 200 3ms',
    )

    const [line] = lines
    expect(line.req.headers.authorization).toBe(REDACT_CENSOR)
    expect(line.req.headers['x-api-key']).toBe(REDACT_CENSOR)
    expect(line.req.headers.cookie).toBe(REDACT_CENSOR)
    expect(line.req.headers['stripe-signature']).toBe(REDACT_CENSOR)

    // Nothing sensitive survives anywhere in the serialized line
    const raw = JSON.stringify(line)
    expect(raw).not.toContain('super-secret-payload')
    expect(raw).not.toContain(API_KEY)
    expect(raw).not.toContain('do-not-log-me')
    expect(raw).not.toContain('deadbeefcafe')
  })

  // pino-http installs pino's standard request serializer by default, and that
  // serializer copies the *entire* headers object onto the record. This test
  // pins the actual leak vector rather than a hand-rolled approximation.
  it('redacts headers produced by pino\u2019s standard request serializer', () => {
    const { logger, lines } = captureLines()

    const serialized = pino.stdSerializers.req({
      method: 'POST',
      url: '/api/billing/webhook',
      headers: {
        authorization: ACCESS_TOKEN,
        'x-api-key': API_KEY,
        'stripe-signature': STRIPE_SIG,
        'user-agent': 'vitest',
      },
      socket: {},
    })

    // Sanity check: the serializer really does carry the credentials through,
    // so this test would fail loudly if redaction were removed.
    expect(serialized.headers.authorization).toBe(ACCESS_TOKEN)

    logger.info({ req: serialized }, 'POST /api/billing/webhook 200 5ms')

    const [line] = lines
    expect(line.req.headers.authorization).toBe(REDACT_CENSOR)
    expect(line.req.headers['x-api-key']).toBe(REDACT_CENSOR)
    expect(line.req.headers['stripe-signature']).toBe(REDACT_CENSOR)
    // Redaction is targeted — benign headers are still logged for debugging
    expect(line.req.headers['user-agent']).toBe('vitest')
  })

  it('redacts set-cookie on response records', () => {
    const { logger, lines } = captureLines()

    logger.info({ res: { statusCode: 200, headers: { 'set-cookie': COOKIE } } }, 'response')

    expect(lines[0].res.headers['set-cookie']).toBe(REDACT_CENSOR)
  })

  it('leaves ordinary log payloads untouched', () => {
    const { logger, lines } = captureLines()

    logger.info({ userId: 'user_123', deleted: 4 }, 'cleanup done')

    expect(lines[0].userId).toBe('user_123')
    expect(lines[0].deleted).toBe(4)
    expect(lines[0].msg).toBe('cleanup done')
  })
})
