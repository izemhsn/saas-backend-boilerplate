import { Worker } from 'bullmq'
import { getRedisConnection } from '../../config/redis.js'
import logger from '../../utils/logger.js'
import { prisma } from '../../config/db.js'

const QUEUE_NAME = 'maintenance'

let worker = null

const cleanupRefreshTokens = async () => {
  const result = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { revoked: true, updatedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      ],
    },
  })
  logger.info({ deleted: result.count }, 'Expired/revoked refresh tokens cleaned up')
  return { deleted: result.count }
}

const processMaintenanceJob = async (job) => {
  const { name } = job

  logger.info({ jobId: job.id, jobName: name }, 'Processing maintenance job')

  switch (name) {
    case 'cleanupRefreshTokens':
      return await cleanupRefreshTokens()
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
