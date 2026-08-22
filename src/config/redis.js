import IORedis from 'ioredis'
import logger from '../utils/logger.js'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'

let connection = null

// BullMQ requires maxRetriesPerRequest: null on its connection — BullMQ issues
// blocking commands (e.g. BRPOPLPUSH) that must be allowed to wait/retry
// indefinitely across reconnects, and it manages its own retry semantics.
// This connection must stay dedicated to jobs; see getRateLimitRedisConnection
// below for why request-serving code must NOT share it.
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

let rateLimitConnection = null

// Separate connection for the rate limiter, deliberately configured to fail
// FAST rather than wait. With maxRetriesPerRequest: null (the BullMQ
// connection above), a Redis outage leaves in-flight rate-limit commands
// queued for ~10-20s before ioredis gives up and flushes the queue with a
// rejection — which, with no local catch, becomes an unhandledRejection that
// tears down the whole process (see server.js's unhandledRejection handler).
// maxRetriesPerRequest: 1 + a short commandTimeout make that rejection arrive
// in ~200ms-1s instead, so a request can fail open (see app.js's
// passOnStoreError) rather than hang or crash the server.
export const getRateLimitRedisConnection = () => {
  if (!rateLimitConnection) {
    rateLimitConnection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      commandTimeout: 1000,
      // Keep retrying to reconnect in the background indefinitely (unlike the
      // BullMQ connection, never give up) so rate limiting silently resumes
      // once Redis recovers, without needing a process restart.
      retryStrategy: (times) => Math.min(times * 200, 2000),
    })

    rateLimitConnection.on('connect', () => {
      logger.info('Rate-limit Redis connection established')
    })

    // Logged at 'warn', not 'error' — this connection is allowed to be down;
    // the rate limiter fails open rather than failing the request.
    rateLimitConnection.on('error', (err) => {
      logger.warn({ err }, 'Rate-limit Redis connection error')
    })
  }
  return rateLimitConnection
}

export const closeRateLimitRedisConnection = async () => {
  if (rateLimitConnection) {
    await rateLimitConnection.quit()
    rateLimitConnection = null
  }
}
