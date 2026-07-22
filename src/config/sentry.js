import * as Sentry from '@sentry/node'
import logger from '../utils/logger.js'

let initialized = false

export const initSentry = () => {
  if (process.env.NODE_ENV === 'test') return false
  if (!process.env.SENTRY_DSN) {
    logger.info('SENTRY_DSN not set — Sentry disabled')
    return false
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? 0.1),
  })

  initialized = true
  logger.info('Sentry initialized')
  return true
}

export const getSentry = () => {
  if (!initialized) return null
  return Sentry
}

export { Sentry }
