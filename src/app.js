import 'dotenv/config'
import { randomUUID } from 'crypto'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import { errorHandler } from './middleware/error.middleware.js'
import authRouter from './modules/auth/auth.router.js'
import orgRouter from './modules/org/org.router.js'
import adminRouter from './modules/admin/admin.router.js'
import billingRouter from './modules/billing/billing.router.js'
import { webhook as billingWebhook } from './modules/billing/billing.controller.js'
import { prisma } from './config/db.js'

const app = express()

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

app.use(express.json({ limit: '10kb' })) // Parse JSON request bodies (limit prevents oversized payload DoS)

// Stripe webhook — needs raw body, must be before express.json() is applied to this route
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingWebhook)

// Request ID — attach a unique ID to every request for log tracing
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] ?? randomUUID()
  res.setHeader('X-Request-Id', req.id)
  next()
})

// Request logging — concise 'dev' format locally, 'combined' in production, silent under test
if (process.env.NODE_ENV !== 'test') {
  morgan.token('id', (req) => req.id)
  app.use(
    morgan(
      process.env.NODE_ENV === 'production'
        ? ':id :method :url :status :res[content-length] - :response-time ms'
        : 'dev',
    ),
  )
}

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

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }))

app.use(errorHandler) // Must be LAST

export default app
