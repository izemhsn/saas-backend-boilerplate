import { Queue } from 'bullmq'
import { getRedisConnection } from '../../config/redis.js'

const EMAIL_QUEUE_NAME = 'email'
const MAINTENANCE_QUEUE_NAME = 'maintenance'

let emailQueue = null
let maintenanceQueue = null

export const getEmailQueue = () => {
  if (!emailQueue) {
    emailQueue = new Queue(EMAIL_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    })
  }
  return emailQueue
}

export const getMaintenanceQueue = () => {
  if (!maintenanceQueue) {
    maintenanceQueue = new Queue(MAINTENANCE_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 200 },
      },
    })
  }
  return maintenanceQueue
}

export const QUEUE_NAMES = {
  EMAIL: EMAIL_QUEUE_NAME,
  MAINTENANCE: MAINTENANCE_QUEUE_NAME,
}
