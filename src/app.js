import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { errorHandler } from './middleware/error.middleware.js'
import authRouter from './modules/auth/auth.router.js'

const app = express()

app.use(helmet())        // Secure HTTP headers
app.use(cors())          // Allow cross-origin requests
app.use(express.json())  // Parse JSON request bodies

// Health check — for uptime monitoring & load balancers
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/auth', authRouter)

app.use(errorHandler) // Must be LAST

export default app