import { Worker } from 'bullmq'
import { getRedisConnection } from '../../config/redis.js'
import logger from '../../utils/logger.js'
import { sendVerificationEmail, sendPasswordResetEmail } from '../shared/email.service.js'

const QUEUE_NAME = 'email'

let worker = null

const processEmailJob = async (job) => {
  const { name, data } = job

  logger.info({ jobId: job.id, jobName: name }, 'Processing email job')

  switch (name) {
    case 'sendVerificationEmail':
      await sendVerificationEmail(data)
      break
    case 'sendPasswordResetEmail':
      await sendPasswordResetEmail(data)
      break
    default:
      logger.warn({ jobId: job.id, jobName: name }, 'Unknown email job type')
  }
}

export const startEmailWorker = () => {
  if (worker) {
    logger.warn('Email worker already started')
    return worker
  }

  worker = new Worker(QUEUE_NAME, processEmailJob, {
    connection: getRedisConnection(),
    concurrency: 5,
  })

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, jobName: job.name }, 'Email job completed')
  })

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err: err.message }, 'Email job failed')
  })

  worker.on('error', (err) => {
    logger.error({ err }, 'Email worker error')
  })

  logger.info('Email worker started')
  return worker
}

export const stopEmailWorker = async () => {
  if (worker) {
    await worker.close()
    worker = null
    logger.info('Email worker stopped')
  }
}
