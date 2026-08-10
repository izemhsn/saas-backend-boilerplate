import { resolveLocale, t as translate } from '../i18n/index.js'

// i18n middleware — resolves the request locale from the Accept-Language
// header (or X-Lang override) and attaches:
//   req.lang — the resolved locale code (e.g. "en", "fr")
//   req.t    — a bound translate function: req.t(key, params)
//
// Registered early in the pipeline (before routes) so every handler and
// the error middleware can produce locale-aware messages.
export const i18nMiddleware = (req, _res, next) => {
  // X-Lang header takes priority over Accept-Language for explicit control
  const explicit = req.headers['x-lang']
  req.lang =
    explicit && explicit.length >= 2
      ? explicit.slice(0, 2).toLowerCase()
      : resolveLocale(req.headers['accept-language'])

  // Bound translate function — always falls back to the default locale
  req.t = (key, params = {}) => translate(key, req.lang, params)

  next()
}
