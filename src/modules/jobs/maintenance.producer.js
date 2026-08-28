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

// M6: the other tables that otherwise grow forever (2FA challenges, audit
// logs, notifications, terminal invitations) get the same daily cadence as
// the refresh-token cleanup above — a distinct job name and BullMQ `jobId`
// per table so they run as independent repeat jobs, not duplicates of it.
const OTHER_CLEANUP_JOB_NAMES = [
  'cleanupTwoFactorChallenges',
  'cleanupAuditLogs',
  'cleanupNotifications',
  'cleanupTerminalInvitations',
  'cleanupFailedJobs',
]

export const scheduleDataRetentionCleanup = async () => {
  if (isTest || isQueueDisabled) {
    logger.debug('Maintenance queue disabled — skipping data retention cleanup scheduling')
    return
  }

  const queue = getMaintenanceQueue()
  await Promise.all(
    OTHER_CLEANUP_JOB_NAMES.map((jobName) =>
      queue.add(
        jobName,
        {},
        {
          repeat: { pattern: CLEANUP_CRON },
          jobId: jobName,
        },
      ),
    ),
  )
  logger.info(
    { cron: CLEANUP_CRON, jobs: OTHER_CLEANUP_JOB_NAMES },
    'Data retention cleanup jobs scheduled',
  )
}
