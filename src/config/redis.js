import IORedis from 'ioredis'
import logger from '../utils/logger.js'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'

let connection = null

export const getRedisConnection = () => {
  if (!connection) {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (times) => {
        if (times > 10) {
          logger.error({ times }, 'Redis connection retries exhausted')
          return null
        }
        return Math.min(times * 200, 2000)
      },
    })

    connection.on('connect', () => {
      logger.info('Redis connected')
    })

    connection.on('error', (err) => {
      logger.error({ err }, 'Redis connection error')
    })
  }
  return connection
}

export const closeRedisConnection = async () => {
  if (connection) {
    await connection.quit()
    connection = null
  }
}
