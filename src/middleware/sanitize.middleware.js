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
  return str
    .replace(HTML_TAG_RE, '')
    .replace(JS_URI_RE, '')
    .replace(ON_EVENT_RE, '')
}

export const sanitizeValue = (value, depth = 0) => {
  if (depth > 10) return value // Prevent deeply nested payloads from causing excessive recursion
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return sanitizeString(value)
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1))

  const cleaned = {}
  for (const [key, val] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) continue
    if (key.startsWith('$')) continue // Strip Prisma/Mongo operator keys ($gt, $or, etc.)
    cleaned[key] = sanitizeValue(val, depth + 1)
  }
  return cleaned
}

// Recursively sanitizes an object in-place: strips dangerous keys, $-prefixed keys,
// and sanitizes string values. Returns the same object reference.
const sanitizeInPlace = (obj, depth = 0) => {
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

// Sanitizes req.body, req.query, and req.params in-place.
// Must run after express.json() (so req.body is populated) and before validate().
export const sanitizeRequest = (req, _res, next) => {
  if (req.body && typeof req.body === 'object') {
    sanitizeInPlace(req.body)
  }
  if (req.query && typeof req.query === 'object') {
    sanitizeInPlace(req.query)
  }
  if (req.params && typeof req.params === 'object') {
    sanitizeInPlace(req.params)
  }
  next()
}
