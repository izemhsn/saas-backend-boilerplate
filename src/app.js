import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { errorHandler } from './middleware/error.middleware.js'
import authRouter from './modules/auth/auth.router.js'

const app = express()

app.use(helmet())        // Secure HTTP headers
app.use(cors({ origin: process.env.CORS_ORIGIN ?? '*' }))  // Restrict in production via CORS_ORIGIN
app.use(express.json())  // Parse JSON request bodies

// Health check — for uptime monitoring & load balancers
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
})

const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
})

app.use('/api/auth', authLimiter)
app.post('/api/auth/login',    sensitiveLimiter)
app.post('/api/auth/register', sensitiveLimiter)
app.use('/api/auth', authRouter)

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }))

app.use(errorHandler) // Must be LAST

export default app