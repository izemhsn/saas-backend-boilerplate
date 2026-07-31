import * as Sentry from '@sentry/node'

// Sentry is initialized in src/instrument.js, which is loaded via
// `node --import` before the app starts. This module just re-exports
// the Sentry instance and provides a helper for error handlers.

export const getSentry = () => {
  if (process.env.NODE_ENV === 'test') return null
  if (!process.env.SENTRY_DSN) return null
  return Sentry
}

export { Sentry }
