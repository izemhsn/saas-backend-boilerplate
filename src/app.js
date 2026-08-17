import 'dotenv/config'
import { randomUUID } from 'crypto'
import * as Sentry from '@sentry/node'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import pinoHttp from 'pino-http'
import logger from './utils/logger.js'
import { errorHandler } from './middleware/error.middleware.js'
import { sanitizeRequest } from './middleware/sanitize.middleware.js'
import { i18nMiddleware } from './middleware/i18n.middleware.js'
import authRouter from './modules/auth/auth.router.js'
import orgRouter from './modules/org/org.router.js'
import adminRouter from './modules/admin/admin.router.js'
import billingRouter from './modules/billing/billing.router.js'
import apiKeyRouter from './modules/apikey/apikey.router.js'
import sessionRouter from './modules/session/session.router.js'
import auditRouter from './modules/audit/audit.router.js'
import invitationRouter from './modules/org/invitation.router.js'
import notificationRouter from './modules/notification/notification.router.js'
import featureFlagRouter from './modules/featureflag/featureflag.router.js'
import docsRouter from './modules/docs/docs.router.js'
import { webhook as billingWebhook } from './modules/billing/billing.controller.js'
import { prisma } from './config/db.js'
import { RedisStore } from 'rate-limit-redis'
import { getRedisConnection } from './config/redis.js'

const app = express()

// Trust the reverse proxy (load balancer / ingress) so req.ip and rate limiting
// use the real client IP from X-Forwarded-For. Configure hop count via TRUST_PROXY.
if (process.env.TRUST_PROXY) {
  const trustProxy = process.env.TRUST_PROXY
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy)
}

app.use(helmet()) // Secure HTTP headers
app.use(compression({ threshold: 0 })) // Gzip compression for all responses

// CORS — never default to wildcard in production.
// CORS_ORIGIN may be a single origin or a comma-separated list (e.g.
// "https://app.example.com,https://admin.example.com").
const corsOrigin = process.env.CORS_ORIGIN ?? '*'
const originList = corsOrigin.split(',').map((o) => o.trim()).filter(Boolean)
const corsOptions = {
  origin: originList.length === 1 ? originList[0] : originList.length > 1 ? originList : '*',
}
if (corsOrigin !== '*') {
  corsOptions.credentials = true
}
app.use(cors(corsOptions))

// Request ID — attach a unique ID to every request for log tracing.
// If the client sends a valid X-Request-Id (string, ≤128 chars, alphanumeric
// + hyphens/underscores), use it; otherwise generate a fresh UUID. This
// prevents log injection via arrays or arbitrarily long strings.
// Registered BEFORE the Stripe webhook route so webhook requests are traced
// too (this middleware doesn't touch the body).
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
app.use((req, res, next) => {
  const clientId = req.headers['x-request-id']
  req.id = typeof clientId === 'string' && REQUEST_ID_RE.test(clientId) ? clientId : randomUUID()
  res.setHeader('X-Request-Id', req.id)
  next()
})

// Structured request logging via pino-http — JSON in production, pretty in dev, silent in test.
// Also registered BEFORE the webhook route (logging doesn't consume the body),
// so webhook requests appear in the access log with their request ID.
app.use(
  pinoHttp({
    logger,
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return 'error'
      if (res.statusCode >= 400) return 'warn'
      return 'info'
    },
    customSuccessMessage: (req, res) =>
      `${req.method} ${req.url} ${res.statusCode} ${res.responseTime}ms`,
    customErrorMessage: (req, res, err) =>
      `${req.method} ${req.url} ${res.statusCode} ${err.message}`,
    reqCustomProps: (req) => ({ requestId: req.id }),
  }),
)

// Stripe webhook — needs the raw body for signature verification, so it MUST be
// registered before express.json() (otherwise the JSON parser consumes the body first)
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingWebhook)

app.use(express.json({ limit: '10kb' })) // Parse JSON request bodies (limit prevents oversized payload DoS)

// Sanitize input — strips HTML tags, javascript: URIs, on* event handlers,
// $ operator keys, and prototype pollution keys from body/query/params
app.use(sanitizeRequest)

// i18n — resolve the request locale from Accept-Language (or X-Lang override)
// and attach req.lang + req.t() so every handler can produce localized messages.
// Runs after sanitize (which doesn't affect headers) and before routes.
app.use(i18nMiddleware)

// Rate limiting is disabled under test so the Supertest suite isn't throttled
const skipInTest = () => process.env.NODE_ENV === 'test'

// Each rate limiter needs its own RedisStore instance — express-rate-limit v7
// rejects a shared store (ERR_ERL_STORE_REUSE). All stores reuse the same
// ioredis connection but use distinct key prefixes so counters are isolated
// (without a prefix every limiter would share the default 'rl:' keyspace and
// increment the same per-IP counter).
// In test mode no store is created (rate limiting is skipped via `skipInTest`).
const createRedisStore = (prefix) =>
  process.env.NODE_ENV !== 'test'
    ? new RedisStore({
        prefix,
        sendCommand: (...args) => getRedisConnection().call(...args),
      })
    : undefined

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: skipInTest,
  store: createRedisStore('rl:auth:'),
})

// Each sensitive route gets its own limiter (and Redis prefix) so a burst on
// one endpoint (e.g. login retries) can't exhaust the budget of another
// (e.g. refresh) for the same IP.
const createSensitiveLimiter = (name) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: skipInTest,
    store: createRedisStore(`rl:sensitive:${name}:`),
  })

// Health checks — liveness (no DB, cheap) and readiness (DB ping).
// Rate-limited to prevent abuse; load balancers should hit these at reasonable intervals.
const healthLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: skipInTest,
  store: createRedisStore('rl:health:'),
})

app.get('/health', healthLimiter, (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.get('/health/ready', healthLimiter, async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  } catch {
    res.status(503).json({ status: 'error', message: req.t('errors.databaseUnavailable') })
  }
})

app.use('/api/auth', authLimiter)
app.post('/api/auth/login', createSensitiveLimiter('login'))
app.post('/api/auth/register', createSensitiveLimiter('register'))
app.post('/api/auth/refresh', createSensitiveLimiter('refresh'))
app.post('/api/auth/verify-email', createSensitiveLimiter('verify-email'))
app.post('/api/auth/forgot-password', createSensitiveLimiter('forgot-password'))
app.post('/api/auth/reset-password', createSensitiveLimiter('reset-password'))
app.post('/api/auth/resend-verification', createSensitiveLimiter('resend-verification'))
app.post('/api/auth/change-password', createSensitiveLimiter('change-password'))
app.post('/api/auth/change-email', createSensitiveLimiter('change-email'))
app.post('/api/auth/google', createSensitiveLimiter('google'))
app.post('/api/auth/2fa/verify', createSensitiveLimiter('2fa-verify'))
app.use('/api/auth', authRouter)

app.use('/api/organizations', authLimiter)
app.use('/api/organizations', orgRouter)

app.use('/api/admin', authLimiter)
app.use('/api/admin', adminRouter)

app.use('/api/billing', authLimiter)
app.use('/api/billing', billingRouter)

app.use('/api/api-keys', authLimiter)
app.use('/api/api-keys', apiKeyRouter)

app.use('/api/sessions', authLimiter)
app.use('/api/sessions', sessionRouter)

app.use('/api/audit', authLimiter)
app.use('/api/audit', auditRouter)

app.use('/api/invitations', authLimiter)
app.use('/api/invitations', invitationRouter)

app.use('/api/notifications', authLimiter)
app.use('/api/notifications', notificationRouter)

app.use('/api/feature-flags', authLimiter)
app.use('/api/feature-flags', featureFlagRouter)

// API documentation — OpenAPI 3.0 spec + Swagger UI (not rate-limited so
// external tools can fetch the spec without being throttled).
app.use('/api/docs', docsRouter)

app.use((req, res) =>
  res.status(404).json({ success: false, message: req.t('errors.routeNotFound') }),
)

// Sentry error handler — must be before our custom errorHandler
if (process.env.SENTRY_DSN && process.env.NODE_ENV !== 'test') {
  app.use(Sentry.expressErrorHandler())
}

app.use(errorHandler) // Must be LAST

export default app
