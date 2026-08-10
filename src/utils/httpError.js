// Creates an HTTP error with an i18n translation key.
//
// Usage:
//   throw httpError('errors.userNotFound', 404)
//   throw httpError('errors.accountSuspended', 403, { until: date.toISOString() })
//
// The error middleware resolves the key using req.t() (which uses the
// request's locale) to produce a localized message. The raw key is stored
// as err.message so logs show the key (stable across locales) while the
// response body shows the translated string.
export const httpError = (key, statusCode, params = {}) => {
  const err = new Error(key)
  err.statusCode = statusCode
  err.i18n = { key, params }
  return err
}
