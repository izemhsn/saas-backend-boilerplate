import './instrument.js'
import app from './app.js'
import { prisma } from './config/db.js'
import logger from './utils/logger.js'
import { getSentry } from './config/sentry.js'
import { validateEnv } from './config/validateEnv.js'

const envErrors = validateEnv(process.env)
if (envErrors.length) {
  for (const message of envErrors) logger.fatal(message)
  process.exit(1)
}

const PORT = process.env.PORT ?? 3000

const server = app.listen(PORT, () => {
  logger.info(`Server running on http://localhost:${PORT}`)
})

// Graceful shutdown: stop accepting connections, then close the DB pool
let shuttingDown = false
const shutdown = async (signal) => {
  if (shuttingDown) return
  shuttingDown = true
  logger.info(`${signal} received — shutting down gracefully`)
  server.close(async () => {
    await prisma.$disconnect()
    process.exit(0)
  })
  // Force-exit if connections don't drain in time
  setTimeout(() => {
    logger.error('Forced shutdown after timeout')
    process.exit(1)
  }, 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// Catch unhandled errors so the process never silently hangs
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection')
  const sentry = getSentry()
  if (sentry) sentry.captureException(reason)
  shutdown('unhandledRejection')
})

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception')
  const sentry = getSentry()
  if (sentry) sentry.captureException(err)
  shutdown('uncaughtException')
})
