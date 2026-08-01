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

// CORS — never default to wildcard in production
const corsOrigin = process.env.CORS_ORIGIN ?? '*'
const corsOptions = { origin: corsOrigin }
if (corsOrigin !== '*') {
  corsOptions.credentials = true
}
app.use(cors(corsOptions))

// Stripe webhook — needs the raw body for signature verification, so it MUST be
// registered before express.json() (otherwise the JSON parser consumes the body first)
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingWebhook)

app.use(express.json({ limit: '10kb' })) // Parse JSON request bodies (limit prevents oversized payload DoS)

// Sanitize input — strips HTML tags, javascript: URIs, on* event handlers,
// $ operator keys, and prototype pollution keys from body/query/params
app.use(sanitizeRequest)

// Request ID — attach a unique ID to every request for log tracing.
// If the client sends a valid X-Request-Id (string, ≤128 chars, alphanumeric
// + hyphens/underscores), use it; otherwise generate a fresh UUID. This
// prevents log injection via arrays or arbitrarily long strings.
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
app.use((req, res, next) => {
  const clientId = req.headers['x-request-id']
  req.id = typeof clientId === 'string' && REQUEST_ID_RE.test(clientId) ? clientId : randomUUID()
  res.setHeader('X-Request-Id', req.id)
  next()
})

// Structured request logging via pino-http — JSON in production, pretty in dev, silent in test
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

// Rate limiting is disabled under test so the Supertest suite isn't throttled
const skipInTest = () => process.env.NODE_ENV === 'test'

// Use a Redis-backed store so rate limits are shared across instances when scaling
// horizontally. In test mode the default in-memory store is used (rate limiting is
// skipped anyway via `skipInTest`).
const redisStore =
  process.env.NODE_ENV !== 'test'
    ? new RedisStore({
        sendCommand: (...args) => getRedisConnection().call(...args),
      })
    : undefined

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: skipInTest,
  store: redisStore,
})

const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: skipInTest,
  store: redisStore,
})

// Health checks — liveness (no DB, cheap) and readiness (DB ping).
// Rate-limited to prevent abuse; load balancers should hit these at reasonable intervals.
const healthLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: skipInTest,
  store: redisStore,
})

app.get('/health', healthLimiter, (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.get('/health/ready', healthLimiter, async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  } catch {
    res.status(503).json({ status: 'error', message: 'Database unavailable' })
  }
})

app.use('/api/auth', authLimiter)
app.post('/api/auth/login', sensitiveLimiter)
app.post('/api/auth/register', sensitiveLimiter)
app.post('/api/auth/refresh', sensitiveLimiter)
app.post('/api/auth/verify-email', sensitiveLimiter)
app.post('/api/auth/forgot-password', sensitiveLimiter)
app.post('/api/auth/reset-password', sensitiveLimiter)
app.post('/api/auth/resend-verification', sensitiveLimiter)
app.post('/api/auth/change-password', sensitiveLimiter)
app.post('/api/auth/change-email', sensitiveLimiter)
app.post('/api/auth/google', sensitiveLimiter)
app.post('/api/auth/2fa/verify', sensitiveLimiter)
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

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }))

// Sentry error handler — must be before our custom errorHandler
if (process.env.SENTRY_DSN && process.env.NODE_ENV !== 'test') {
  app.use(Sentry.expressErrorHandler())
}

app.use(errorHandler) // Must be LAST

export default app
