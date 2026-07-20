import { Queue } from 'bullmq'
import { getRedisConnection } from '../../config/redis.js'

const QUEUE_NAME = 'email'

let queue = null

export const getEmailQueue = () => {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
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
  return queue
}

export const QUEUE_NAMES = {
  EMAIL: QUEUE_NAME,
}
