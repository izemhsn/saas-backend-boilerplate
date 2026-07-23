import 'dotenv/config'
import { startEmailWorker } from './modules/jobs/email.worker.js'
import { startMaintenanceWorker } from './modules/jobs/maintenance.worker.js'
import { scheduleRefreshTokenCleanup } from './modules/jobs/maintenance.producer.js'
import { closeRedisConnection } from './config/redis.js'
import logger from './utils/logger.js'

const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'REDIS_URL']
const missing = REQUIRED_ENV.filter((key) => !process.env[key])
if (missing.length) {
  logger.fatal(`Missing required env vars: ${missing.join(', ')}`)
  process.exit(1)
}

startEmailWorker()
startMaintenanceWorker()
scheduleRefreshTokenCleanup().catch((err) =>
  logger.error({ err }, 'Failed to schedule refresh token cleanup'),
)

let shuttingDown = false
const shutdown = async (signal) => {
  if (shuttingDown) return
  shuttingDown = true
  logger.info(`${signal} received — shutting down worker`)
  await closeRedisConnection()
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
