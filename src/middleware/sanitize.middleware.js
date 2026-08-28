// Keys that enable prototype pollution attacks — always stripped from input.
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

// HTML tag pattern — strips actual HTML tags (starts with letter or /), not math comparisons
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g

// javascript: URI pattern — strips inline script execution via href/src
const JS_URI_RE = /javascript:/gi

// on* event handler pattern — strips inline event handlers including their values
const ON_EVENT_RE = /\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s]*)/gi

export const sanitizeString = (str) => {
  if (typeof str !== 'string') return str
  return str.replace(HTML_TAG_RE, '').replace(JS_URI_RE, '').replace(ON_EVENT_RE, '')
}

// Pure (non-mutating) sanitizer — returns a new cleaned object. Used by tests.
// The middleware itself uses sanitizeInPlace (below) for performance.
export const sanitizeValue = (value, depth = 0) => {
  if (depth > 10) return value
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return sanitizeString(value)
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1))

  const cleaned = {}
  for (const [key, val] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) continue
    if (key.startsWith('$')) continue
    cleaned[key] = sanitizeValue(val, depth + 1)
  }
  return cleaned
}

// Recursively sanitizes an object in-place: strips dangerous keys, $-prefixed keys,
// and sanitizes string values. Returns the same object reference.
// Exported so validate.middleware.js can clean `req.params`, which does not
// exist yet when this module's middleware runs — see sanitizeRequest below.
export const sanitizeInPlace = (obj, depth = 0) => {
  if (depth > 10 || obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') obj[i] = sanitizeString(obj[i])
      else if (typeof obj[i] === 'object' && obj[i] !== null) sanitizeInPlace(obj[i], depth + 1)
    }
    return obj
  }
  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.has(key) || key.startsWith('$')) {
      delete obj[key]
      continue
    }
    if (typeof obj[key] === 'string') obj[key] = sanitizeString(obj[key])
    else if (typeof obj[key] === 'object' && obj[key] !== null) sanitizeInPlace(obj[key], depth + 1)
  }
  return obj
}

// Sanitizes req.body and req.query.
// Must run after express.json() (so req.body is populated) and before validate().
//
// `req.params` is deliberately NOT handled here: this is app-level middleware,
// and Express only populates params when the router later dispatches to a
// matched route — at this point it is always `{}`. Param sanitization lives in
// validate.middleware.js instead, which runs per-route once params exist.
export const sanitizeRequest = (req, _res, next) => {
  if (req.body && typeof req.body === 'object') {
    sanitizeInPlace(req.body)
  }

  // Express 5 defines `query` as a getter on the request prototype that
  // re-parses the query string on *every* access and returns a fresh object
  // each time (see express/lib/request.js). Mutating what it returns is
  // therefore discarded — the next reader re-parses the raw, unsanitized
  // string. Shadow the getter with an own data property holding a sanitized
  // copy, so validate() and every controller downstream see the clean values.
  const rawQuery = req.query
  if (rawQuery && typeof rawQuery === 'object') {
    Object.defineProperty(req, 'query', {
      value: sanitizeValue(rawQuery),
      writable: true,
      configurable: true,
      enumerable: true,
    })
  }

  next()
}
