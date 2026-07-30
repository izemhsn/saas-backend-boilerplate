import * as Sentry from '@sentry/node'
import logger from './utils/logger.js'

if (process.env.NODE_ENV !== 'test' && process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? 0.1),
  })
  logger.info('Sentry initialized (preload)')
} else if (process.env.NODE_ENV !== 'test') {
  logger.info('SENTRY_DSN not set — Sentry disabled')
}

export { Sentry }
