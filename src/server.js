import app from './app.js'
import { prisma } from './config/db.js'

const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET']
const missing = REQUIRED_ENV.filter((key) => !process.env[key])
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`)
  process.exit(1)
}

// In production, JWT secrets must be at least 32 characters and CORS must be set
if (process.env.NODE_ENV === 'production') {
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    if (process.env[key].length < 32) {
      console.error(`${key} must be at least 32 characters in production`)
      process.exit(1)
    }
  }
  if (!process.env.CORS_ORIGIN) {
    console.error('CORS_ORIGIN must be set in production')
    process.exit(1)
  }
}

const PORT = process.env.PORT ?? 3000

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})

// Graceful shutdown: stop accepting connections, then close the DB pool
let shuttingDown = false
const shutdown = async (signal) => {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} received — shutting down gracefully`)
  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  // Force-exit if connections don't drain in time
  setTimeout(() => {
    console.error('Forced shutdown after timeout')
    process.exit(1)
  }, 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// Catch unhandled errors so the process never silently hangs
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason)
  shutdown('unhandledRejection')
})

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err)
  shutdown('uncaughtException')
})
