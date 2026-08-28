import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { z } from 'zod'
import {
  sanitizeString,
  sanitizeValue,
  sanitizeRequest,
} from '../src/middleware/sanitize.middleware.js'
import { validate } from '../src/middleware/validate.middleware.js'
import { i18nMiddleware } from '../src/middleware/i18n.middleware.js'

describe('sanitizeString', () => {
  it('strips HTML tags', () => {
    expect(sanitizeString('<script>alert("xss")</script>')).toBe('alert("xss")')
    expect(sanitizeString('<img src=x>')).toBe('')
    expect(sanitizeString('<div>content</div>')).toBe('content')
  })

  it('strips javascript: URIs', () => {
    expect(sanitizeString('javascript:alert(1)')).toBe('alert(1)')
    expect(sanitizeString('JAVASCRIPT:alert(1)')).toBe('alert(1)')
  })

  it('strips on* event handlers', () => {
    expect(sanitizeString('<img onerror=alert(1) src=x>')).toBe('')
    expect(sanitizeString('text onload=evil()')).toBe('text')
  })

  it('preserves safe strings', () => {
    expect(sanitizeString('Hello World')).toBe('Hello World')
    expect(sanitizeString('user@example.com')).toBe('user@example.com')
    expect(sanitizeString('Tom & Jerry')).toBe('Tom & Jerry')
  })

  it('preserves ampersands and special chars outside HTML', () => {
    expect(sanitizeString('a < b && c > d')).toBe('a < b && c > d')
    expect(sanitizeString('price < 100')).toBe('price < 100')
  })

  it('returns non-strings unchanged', () => {
    expect(sanitizeString(42)).toBe(42)
    expect(sanitizeString(null)).toBeNull()
    expect(sanitizeString(undefined)).toBeUndefined()
  })
})

describe('sanitizeValue — prototype pollution', () => {
  it('strips __proto__ key', () => {
    const input = JSON.parse('{"name":"test","__proto__":{"polluted":true}}')
    const result = sanitizeValue(input)
    expect(Object.keys(result)).not.toContain('__proto__')
    expect(result.name).toBe('test')
    expect(Object.prototype.polluted).toBeUndefined()
  })

  it('strips constructor key', () => {
    const input = JSON.parse('{"name":"test","constructor":{"prototype":{"polluted":true}}}')
    const result = sanitizeValue(input)
    expect(Object.keys(result)).not.toContain('constructor')
    expect(result.name).toBe('test')
  })

  it('strips prototype key', () => {
    const input = { name: 'test', prototype: { polluted: true } }
    const result = sanitizeValue(input)
    expect(result.prototype).toBeUndefined()
    expect(result.name).toBe('test')
  })
})

describe('sanitizeValue — operator injection', () => {
  it('strips $-prefixed keys', () => {
    const input = { $gt: '', $or: [], $where: 'this.password', name: 'test' }
    const result = sanitizeValue(input)
    expect(result.$gt).toBeUndefined()
    expect(result.$or).toBeUndefined()
    expect(result.$where).toBeUndefined()
    expect(result.name).toBe('test')
  })

  it('strips $-prefixed keys in nested objects', () => {
    const input = { filter: { $contains: 'evil', name: 'test' } }
    const result = sanitizeValue(input)
    expect(result.filter.$contains).toBeUndefined()
    expect(result.filter.name).toBe('test')
  })
})

describe('sanitizeValue — XSS in nested structures', () => {
  it('sanitizes strings in nested objects', () => {
    const input = { user: { name: '<script>alert(1)</script>', email: 'a@b.com' } }
    const result = sanitizeValue(input)
    expect(result.user.name).toBe('alert(1)')
    expect(result.user.email).toBe('a@b.com')
  })

  it('sanitizes strings in arrays', () => {
    const input = { tags: ['<b>safe</b>', 'normal', '<script>xss</script>'] }
    const result = sanitizeValue(input)
    expect(result.tags).toEqual(['safe', 'normal', 'xss'])
  })

  it('handles null and undefined values', () => {
    const input = { a: null, b: undefined, c: 'text' }
    const result = sanitizeValue(input)
    expect(result.a).toBeNull()
    expect(result.b).toBeUndefined()
    expect(result.c).toBe('text')
  })

  it('handles numbers and booleans', () => {
    const input = { a: 42, b: true, c: false }
    const result = sanitizeValue(input)
    expect(result.a).toBe(42)
    expect(result.b).toBe(true)
    expect(result.c).toBe(false)
  })

  it('prevents excessive recursion with depth limit', () => {
    let nested = { value: 'deep' }
    for (let i = 0; i < 15; i++) {
      nested = { child: nested }
    }
    const result = sanitizeValue(nested)
    expect(result).toBeDefined()
  })
})

describe('sanitizeValue — combined attacks', () => {
  it('handles prototype pollution + XSS + operator injection together', () => {
    const input = JSON.parse(
      '{"__proto__":{"admin":true},"$where":"this.password","name":"<script>document.cookie</script>","bio":"javascript:steal()","profile":{"onload":"evil()","real":"data"}}',
    )
    const result = sanitizeValue(input)
    expect(Object.keys(result)).not.toContain('__proto__')
    expect(result.$where).toBeUndefined()
    expect(result.name).toBe('document.cookie')
    expect(result.bio).toBe('steal()')
    expect(result.profile.real).toBe('data')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Regression tests for the middleware itself, driven over real HTTP.
//
// Everything above exercises the pure helpers directly, which is exactly why
// a bug in the middleware's *wiring* went unnoticed: sanitizeRequest mutated
// `req.query` in place, but Express 5 defines `query` as a getter that
// re-parses the query string on every access and hands back a fresh object,
// so the mutation was thrown away and every reader saw raw input. `req.params`
// had a second, unrelated cause — it is empty until the router matches a
// route, long after app-level middleware runs, so sanitizing it there was
// always a no-op.
//
// These build a minimal app from the real middleware rather than importing
// src/app.js, because no production route echoes its own query/params back —
// the assertion needs a handler that reveals what the pipeline actually
// produced.
// ─────────────────────────────────────────────────────────────────────────
describe('sanitizeRequest — over HTTP', () => {
  const buildApp = () => {
    const app = express()
    app.use(express.json())
    app.use(sanitizeRequest)
    app.use(i18nMiddleware)

    const schema = z.object({
      body: z.object({}).loose().optional(),
      query: z.object({}).loose(),
      params: z.object({ id: z.string() }),
    })

    app.get('/echo/:id', validate(schema), (req, res) => {
      res.json({ query: req.query, params: req.validated.params })
    })
    return app
  }

  it('strips HTML tags from query string values', async () => {
    const res = await request(buildApp()).get('/echo/abc').query({ q: '<script>alert(1)</script>' })

    expect(res.status).toBe(200)
    expect(res.body.query.q).toBe('alert(1)')
  })

  it('strips $-prefixed and prototype-pollution keys from the query string', async () => {
    const res = await request(buildApp()).get('/echo/abc?$ne=1&__proto__=polluted&keep=yes')

    expect(res.status).toBe(200)
    expect(res.body.query.$ne).toBeUndefined()
    expect(Object.keys(res.body.query)).not.toContain('__proto__')
    expect(res.body.query.keep).toBe('yes')
  })

  it('strips HTML tags from route params', async () => {
    const res = await request(buildApp()).get(
      `/echo/${encodeURIComponent('<script>hi</script>')}?q=ok`,
    )

    expect(res.status).toBe(200)
    expect(res.body.params.id).toBe('hi')
  })

  it('still sanitizes the JSON body', async () => {
    const app = express()
    app.use(express.json())
    app.use(sanitizeRequest)
    app.use(i18nMiddleware)
    app.post('/body', (req, res) => res.json({ body: req.body }))

    const res = await request(app).post('/body').send({ name: '<b>bold</b>', $where: 'evil' })

    expect(res.status).toBe(200)
    expect(res.body.body.name).toBe('bold')
    expect(res.body.body.$where).toBeUndefined()
  })
})
