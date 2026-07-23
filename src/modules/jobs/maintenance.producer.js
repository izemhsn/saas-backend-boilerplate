import { getMaintenanceQueue } from './queues.js'
import logger from '../../utils/logger.js'

const isTest = process.env.NODE_ENV === 'test'
const isQueueDisabled = process.env.JOB_QUEUE_DISABLED === 'true'

const CLEANUP_CRON = process.env.TOKEN_CLEANUP_CRON ?? '0 3 * * *' // daily at 3 AM

export const scheduleRefreshTokenCleanup = async () => {
  if (isTest || isQueueDisabled) {
    logger.debug('Maintenance queue disabled — skipping refresh token cleanup scheduling')
    return
  }

  const queue = getMaintenanceQueue()
  await queue.add(
    'cleanupRefreshTokens',
    {},
    {
      repeat: { pattern: CLEANUP_CRON },
      jobId: 'cleanupRefreshTokens',
    },
  )
  logger.info({ cron: CLEANUP_CRON }, 'Refresh token cleanup job scheduled')
}
