import { describe, it, expect } from 'vitest'
import request from 'supertest'
import express from 'express'
import { z } from 'zod'
import app from '../src/app.js'
import { validate } from '../src/middleware/validate.middleware.js'
import { i18nMiddleware } from '../src/middleware/i18n.middleware.js'

// The response envelope documents validation failures as
// `{ success: false, errors: { field: [msg] } }`. Zod's `flatten()` keys by
// `path[0]`, which for a `{ body, query, params }` schema is always the
// container name — collapsing every message under `body` and losing the field.
// These tests pin the real field names so that regression cannot return.

describe('validate middleware — field naming', () => {
  it('keys errors by field name, not by the body/query/params container', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'T',
      email: 'not-an-email',
      password: 'short',
    })

    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(res.body.errors.body).toBeUndefined()
    expect(res.body.errors.email).toBeDefined()
    expect(res.body.errors.password).toBeDefined()
  })

  it('reports each failing field separately', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'T',
      email: 'not-an-email',
      password: 'short',
    })

    expect(Object.keys(res.body.errors).sort()).toEqual(['email', 'name', 'password'])
    expect(Array.isArray(res.body.errors.email)).toBe(true)
  })

  it('keys params errors by the param name', async () => {
    const res = await request(app)
      .get('/api/organizations/not-a-uuid')
      .set('Authorization', 'Bearer invalid')

    // Either the guard rejects first (401) or validation does (400 with a real
    // field name) — what must never happen is a 400 keyed on `params`.
    if (res.status === 400) {
      expect(res.body.errors.params).toBeUndefined()
    }
  })
})

// A local app is appropriate here: these cases exercise schema shapes that no
// real route currently uses (nested objects, arrays, wrapper-level refinements).
describe('validate middleware — nested and array paths', () => {
  const buildApp = (schema) => {
    const local = express()
    local.use(express.json())
    local.use(i18nMiddleware)
    local.post('/t', validate(schema), (req, res) => res.json({ success: true }))
    return local
  }

  it('joins nested object paths with dots', async () => {
    const schema = z.object({
      body: z.object({
        address: z.object({ city: z.string() }),
      }),
    })

    const res = await request(buildApp(schema))
      .post('/t')
      .send({ address: { city: 42 } })

    expect(res.status).toBe(400)
    expect(res.body.errors['address.city']).toBeDefined()
  })

  it('includes the index for array element paths', async () => {
    const schema = z.object({
      body: z.object({
        items: z.array(z.object({ name: z.string() })),
      }),
    })

    const res = await request(buildApp(schema))
      .post('/t')
      .send({ items: [{ name: 'ok' }, { name: 9 }] })

    expect(res.status).toBe(400)
    expect(res.body.errors['items.1.name']).toBeDefined()
  })

  it('keys a whole-container failure by the container name', async () => {
    const schema = z.object({
      body: z.object({ a: z.string() }),
    })

    const res = await request(buildApp(schema)).post('/t').send([])

    expect(res.status).toBe(400)
    expect(res.body.errors.body).toBeDefined()
  })

  it('translates i18n keys used as field messages', async () => {
    const schema = z.object({
      body: z.object({
        email: z.string().min(50, 'errors.userNotFound'),
      }),
    })

    const res = await request(buildApp(schema)).post('/t').send({ email: 'a@b.co' })

    expect(res.status).toBe(400)
    expect(res.body.errors.email).toContain('User not found')
  })

  it('leaves plain-text messages untranslated', async () => {
    const schema = z.object({
      body: z.object({
        email: z.string().min(50, 'this is too short'),
      }),
    })

    const res = await request(buildApp(schema)).post('/t').send({ email: 'a@b.co' })

    expect(res.status).toBe(400)
    expect(res.body.errors.email).toContain('this is too short')
  })
})
