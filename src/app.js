import 'dotenv/config'
import { randomUUID } from 'crypto'
import * as Sentry from '@sentry/node'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import pinoHttp from 'pino-http'
import logger from './utils/logger.js'
import { errorHandler } from './middleware/error.middleware.js'
import authRouter from './modules/auth/auth.router.js'
import orgRouter from './modules/org/org.router.js'
import adminRouter from './modules/admin/admin.router.js'
import billingRouter from './modules/billing/billing.router.js'
import apiKeyRouter from './modules/apikey/apikey.router.js'
import sessionRouter from './modules/session/session.router.js'
import auditRouter from './modules/audit/audit.router.js'
import invitationRouter from './modules/org/invitation.router.js'
import { webhook as billingWebhook } from './modules/billing/billing.controller.js'
import { prisma } from './config/db.js'
import { initSentry } from './config/sentry.js'

const app = express()

// Initialize Sentry — must happen before any middleware
initSentry()

// Sentry request handler — must be the first middleware on the app
if (process.env.SENTRY_DSN && process.env.NODE_ENV !== 'test') {
  app.use(Sentry.setupExpressErrorHandler(app))
}

// Trust the reverse proxy (load balancer / ingress) so req.ip and rate limiting
// use the real client IP from X-Forwarded-For. Configure hop count via TRUST_PROXY.
if (process.env.TRUST_PROXY) {
  const trustProxy = process.env.TRUST_PROXY
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy)
}

app.use(helmet()) // Secure HTTP headers

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

// Request ID — attach a unique ID to every request for log tracing
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] ?? randomUUID()
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

// Health check — for uptime monitoring & load balancers (includes DB ping)
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  } catch {
    res.status(503).json({ status: 'error', message: 'Database unavailable' })
  }
})

// Rate limiting is disabled under test so the Supertest suite isn't throttled
const skipInTest = () => process.env.NODE_ENV === 'test'

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: skipInTest,
})

const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: skipInTest,
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

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }))

// Sentry error handler — must be before our custom errorHandler
if (process.env.SENTRY_DSN && process.env.NODE_ENV !== 'test') {
  app.use(Sentry.expressErrorHandler())
}

app.use(errorHandler) // Must be LAST

export default app
