import { sanitizeInPlace } from './sanitize.middleware.js'

// Higher-order function: returns a middleware that validates with schema.
// If validation fails, error messages that look like i18n keys (contain a dot
// and no spaces) are translated via req.t(); plain-text messages pass through.

// Schemas are shaped `{ body, query, params }`, so every issue path is prefixed
// with the container it came from. Zod's `flatten()` keys `fieldErrors` by
// `path[0]`, which would collapse every error under `body`/`query`/`params` and
// lose the field name the client actually needs. Drop the container prefix and
// rebuild a dotted path instead: `body.address.city` -> `address.city`,
// `body.items[0].name` -> `items.0.name`.
const fieldKey = (path) => {
  if (path.length === 0) return '_' // schema-level refinement on the wrapper
  if (path.length === 1) return String(path[0]) // the whole container failed
  return path.slice(1).join('.')
}

export const validate = (schema) => (req, res, next) => {
  // Route params only exist once the router has matched a route, which is
  // after app-level sanitizeRequest has already run — so this is the first
  // point in the pipeline where they can be cleaned. Controllers read
  // `req.validated.params`, which is derived from the sanitized object below.
  if (req.params && typeof req.params === 'object') {
    sanitizeInPlace(req.params)
  }

  const result = schema.safeParse({
    body: req.body,
    query: req.query,
    params: req.params,
  })

  if (!result.success) {
    // Translate a field error if it is an i18n key (dot-notation, no spaces)
    const translate = (msg) =>
      typeof msg === 'string' && msg.includes('.') && !msg.includes(' ') ? req.t(msg) : msg

    const errors = {}
    for (const issue of result.error.issues) {
      const key = fieldKey(issue.path)
      errors[key] = errors[key] || []
      errors[key].push(translate(issue.message))
    }

    return res.status(400).json({
      success: false,
      errors,
    })
  }

  req.validated = result.data // use req.validated.body in controllers
  next()
}
