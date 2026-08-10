import logger from '../utils/logger.js'
import { getSentry } from '../config/sentry.js'
import { t as translate, DEFAULT_LOCALE } from '../i18n/index.js'

// 4-parameter signature = Express recognizes this as error middleware
// (_next is required to keep the arity even though it is unused)
export const errorHandler = (err, req, res, _next) => {
  const statusCode = err.statusCode ?? 500
  const isProduction = process.env.NODE_ENV === 'production'

  // Resolve the locale from the request (set by i18n middleware) or fall back
  const locale = req.lang ?? DEFAULT_LOCALE

  // Translate the error message if it carries an i18n key; otherwise use the
  // raw message. 5xx errors are masked in production.
  let message
  if (statusCode >= 500 && isProduction) {
    message = translate('errors.internalServerError', locale)
  } else if (err.i18n) {
    message = translate(err.i18n.key, locale, err.i18n.params)
  } else {
    message = err.message ?? translate('errors.internalServerError', locale)
  }

  if (statusCode >= 500) {
    logger.error({ err, requestId: req.id }, 'Unhandled error')

    const sentry = getSentry()
    if (sentry) {
      sentry.captureException(err)
    }
  } else {
    logger.warn({ err: err.message, statusCode, requestId: req.id }, 'Request error')
  }

  res.status(statusCode).json({
    success: false,
    message,
    // Show stack trace only in development
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  })
}
