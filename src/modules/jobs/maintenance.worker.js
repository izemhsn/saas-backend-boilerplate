import { Worker } from 'bullmq'
import { getRedisConnection } from '../../config/redis.js'
import logger from '../../utils/logger.js'
import { prisma } from '../../config/db.js'
import { handleJobFailure } from './deadLetter.js'

const QUEUE_NAME = 'maintenance'

let worker = null

// M6: retention windows for tables that otherwise grow forever. All
// configurable via env so an adopter can tighten/loosen them without a code
// change; defaults are conservative (long enough that nothing useful is lost).
const AUDIT_LOG_RETENTION_DAYS = Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? 365)
const NOTIFICATION_RETENTION_DAYS = Number(process.env.NOTIFICATION_RETENTION_DAYS ?? 90)
const INVITATION_RETENTION_DAYS = Number(process.env.INVITATION_RETENTION_DAYS ?? 30)
// M8's own dead-letter table (FailedJob) would have the same unbounded-growth
// problem it exists to fix, so it gets a retention window too.
const FAILED_JOB_RETENTION_DAYS = Number(process.env.FAILED_JOB_RETENTION_DAYS ?? 90)
// ProcessedWebhookEvent exists purely to make a redelivered Stripe event a
// no-op. Stripe retries a failed webhook for up to ~3 days, so a row older
// than that can never be needed again — 30 days is a wide margin over that
// window while still bounding what is otherwise the fastest-growing table here.
const WEBHOOK_EVENT_RETENTION_DAYS = Number(process.env.WEBHOOK_EVENT_RETENTION_DAYS ?? 30)

const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000)

// Exported individually so they can be unit-tested (and invoked ad hoc)
// without going through BullMQ.
export const cleanupRefreshTokens = async () => {
  const result = await prisma.refreshToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revoked: true, updatedAt: { lt: daysAgo(7) } }],
    },
  })
  logger.info({ deleted: result.count }, 'Expired/revoked refresh tokens cleaned up')
  return { deleted: result.count }
}

// 2FA login challenges are single-use and short-lived (a few minutes) — once
// expired they serve no purpose, used or not. Unlike the others below this
// has no retention window: expiry itself is the cutoff.
export const cleanupTwoFactorChallenges = async () => {
  const result = await prisma.twoFactorChallenge.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
  logger.info({ deleted: result.count }, 'Expired 2FA challenges cleaned up')
  return { deleted: result.count }
}

export const cleanupAuditLogs = async () => {
  const result = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: daysAgo(AUDIT_LOG_RETENTION_DAYS) } },
  })
  logger.info(
    { deleted: result.count, retentionDays: AUDIT_LOG_RETENTION_DAYS },
    'Old audit logs cleaned up',
  )
  return { deleted: result.count }
}

export const cleanupNotifications = async () => {
  const result = await prisma.notification.deleteMany({
    where: { createdAt: { lt: daysAgo(NOTIFICATION_RETENTION_DAYS) } },
  })
  logger.info(
    { deleted: result.count, retentionDays: NOTIFICATION_RETENTION_DAYS },
    'Old notifications cleaned up',
  )
  return { deleted: result.count }
}

// Only terminal invitations (never PENDING — those are still actionable, and
// deleting one out from under an invitee who hasn't responded yet would
// invalidate a token that's supposed to still work).
export const cleanupTerminalInvitations = async () => {
  const result = await prisma.organizationInvitation.deleteMany({
    where: {
      status: { in: ['ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELED'] },
      updatedAt: { lt: daysAgo(INVITATION_RETENTION_DAYS) },
    },
  })
  logger.info(
    { deleted: result.count, retentionDays: INVITATION_RETENTION_DAYS },
    'Terminal invitations cleaned up',
  )
  return { deleted: result.count }
}

export const cleanupFailedJobs = async () => {
  const result = await prisma.failedJob.deleteMany({
    where: { failedAt: { lt: daysAgo(FAILED_JOB_RETENTION_DAYS) } },
  })
  logger.info(
    { deleted: result.count, retentionDays: FAILED_JOB_RETENTION_DAYS },
    'Old dead-lettered jobs cleaned up',
  )
  return { deleted: result.count }
}

// The Stripe webhook idempotency ledger. Only ever written (insert-or-skip in
// billing.service.js's handleWebhook) and never read back, so nothing depends
// on a row surviving past Stripe's retry window — see the retention constant
// above for why 30 days is safe.
export const cleanupProcessedWebhookEvents = async () => {
  const result = await prisma.processedWebhookEvent.deleteMany({
    where: { createdAt: { lt: daysAgo(WEBHOOK_EVENT_RETENTION_DAYS) } },
  })
  logger.info(
    { deleted: result.count, retentionDays: WEBHOOK_EVENT_RETENTION_DAYS },
    'Old processed webhook events cleaned up',
  )
  return { deleted: result.count }
}

const processMaintenanceJob = async (job) => {
  const { name } = job

  logger.info({ jobId: job.id, jobName: name }, 'Processing maintenance job')

  switch (name) {
    case 'cleanupRefreshTokens':
      return await cleanupRefreshTokens()
    case 'cleanupTwoFactorChallenges':
      return await cleanupTwoFactorChallenges()
    case 'cleanupAuditLogs':
      return await cleanupAuditLogs()
    case 'cleanupNotifications':
      return await cleanupNotifications()
    case 'cleanupTerminalInvitations':
      return await cleanupTerminalInvitations()
    case 'cleanupFailedJobs':
      return await cleanupFailedJobs()
    case 'cleanupProcessedWebhookEvents':
      return await cleanupProcessedWebhookEvents()
    default:
      logger.warn({ jobId: job.id, jobName: name }, 'Unknown maintenance job type')
  }
}

export const startMaintenanceWorker = () => {
  if (worker) {
    logger.warn('Maintenance worker already started')
    return worker
  }

  worker = new Worker(QUEUE_NAME, processMaintenanceJob, {
    connection: getRedisConnection(),
    concurrency: 1,
  })

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, 'Maintenance job completed')
  })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err: err.message }, 'Maintenance job failed')
    handleJobFailure(QUEUE_NAME, job, err).catch((dlqErr) =>
      logger.error({ err: dlqErr }, 'Dead-letter handling failed for maintenance job'),
    )
  })

  worker.on('error', (err) => {
    logger.error({ err }, 'Maintenance worker error')
  })

  logger.info('Maintenance worker started')
  return worker
}

export const stopMaintenanceWorker = async () => {
  if (worker) {
    await worker.close()
    worker = null
    logger.info('Maintenance worker stopped')
  }
}
