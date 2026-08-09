import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { z } from 'zod'
import { zodToOpenApi } from '../src/modules/docs/openapi.converter.js'
import { buildSpec, resetSpecCache } from '../src/modules/docs/openapi.builder.js'
import app from '../src/app.js'

beforeEach(() => {
  // Pick up env changes (e.g. APP_URL) between tests.
  resetSpecCache()
})

describe('API documentation', () => {
  describe('GET /api/docs — OpenAPI JSON spec', () => {
    it('returns a valid OpenAPI 3.0.3 document', async () => {
      const res = await request(app).get('/api/docs')

      expect(res.status).toBe(200)
      expect(res.body.openapi).toBe('3.0.3')
      expect(res.body.info.title).toMatch(/SaaS/i)
      expect(res.body.paths).toBeDefined()
      expect(Object.keys(res.body.paths).length).toBeGreaterThan(40)
    })

    it('includes security schemes for JWT and API key', async () => {
      const res = await request(app).get('/api/docs')

      expect(res.body.components.securitySchemes.bearerAuth).toEqual({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: expect.any(String),
      })
      expect(res.body.components.securitySchemes.apiKeyAuth).toEqual({
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: expect.any(String),
      })
    })

    it('lists tags for every module', async () => {
      const res = await request(app).get('/api/docs')
      const tagNames = res.body.tags.map((t) => t.name)

      expect(tagNames).toEqual(
        expect.arrayContaining([
          'Auth',
          'Organizations',
          'Admin',
          'Billing',
          'API Keys',
          'Sessions',
          'Audit',
          'Invitations',
          'Notifications',
          'Feature Flags',
          'Health',
          'GDPR',
        ]),
      )
    })

    it('documents the register endpoint with request body and responses', async () => {
      const res = await request(app).get('/api/docs')
      const op = res.body.paths['/api/auth/register']?.post

      expect(op).toBeDefined()
      expect(op.summary).toMatch(/register/i)
      expect(op.requestBody.content['application/json'].schema).toBeDefined()
      expect(op.responses['201']).toBeDefined()
      expect(op.responses['400']).toBeDefined()
      // Public endpoint — no security requirement.
      expect(op.security).toBeUndefined()
    })

    it('marks protected endpoints with bearer auth', async () => {
      const res = await request(app).get('/api/docs')
      const op = res.body.paths['/api/auth/me']?.get

      expect(op.security).toEqual([{ bearerAuth: [] }])
    })

    it('marks admin endpoints with bearer auth', async () => {
      const res = await request(app).get('/api/docs')
      const op = res.body.paths['/api/admin/users']?.get

      expect(op.security).toEqual([{ bearerAuth: [] }])
      expect(op.tags).toContain('Admin')
    })

    it('converts Express :params to OpenAPI {params} in paths', async () => {
      const res = await request(app).get('/api/docs')

      expect(res.body.paths['/api/organizations/{orgId}']).toBeDefined()
      expect(res.body.paths['/api/admin/users/{userId}']).toBeDefined()
      expect(res.body.paths['/api/feature-flags/{flagId}/overrides/{orgId}']).toBeDefined()
    })

    it('generates path parameters from Zod params schema', async () => {
      const res = await request(app).get('/api/docs')
      const op = res.body.paths['/api/organizations/{orgId}']?.get

      const pathParam = op.parameters.find((p) => p.in === 'path')
      expect(pathParam).toEqual({
        name: 'orgId',
        in: 'path',
        required: true,
        schema: expect.objectContaining({ type: 'string' }),
      })
    })

    it('generates query parameters from Zod query schema', async () => {
      const res = await request(app).get('/api/docs')
      const op = res.body.paths['/api/billing/plans']?.get

      const queryParams = op.parameters.filter((p) => p.in === 'query')
      const names = queryParams.map((p) => p.name)
      expect(names).toEqual(expect.arrayContaining(['page', 'limit', 'sort', 'order', 'interval']))
      // page/limit/sort/order have defaults → not required.
      expect(queryParams.find((p) => p.name === 'page').required).toBe(false)
    })

    it('wraps response data in the success envelope', async () => {
      const res = await request(app).get('/api/docs')
      const op = res.body.paths['/api/auth/register']?.post
      const schema = op.responses['201'].content['application/json'].schema

      expect(schema.properties.success).toEqual({ type: 'boolean', example: true })
      expect(schema.properties.data).toBeDefined()
      expect(schema.required).toEqual(['success', 'data'])
    })

    it('includes error response schema for error status codes', async () => {
      const res = await request(app).get('/api/docs')
      const op = res.body.paths['/api/auth/login']?.post
      const errorSchema = op.responses['400'].content['application/json'].schema

      expect(errorSchema.properties.success).toBeDefined()
      expect(errorSchema.properties.message).toBeDefined()
    })

    it('uses APP_URL env var for the server URL', async () => {
      const originalUrl = process.env.APP_URL
      process.env.APP_URL = 'https://api.example.com'
      resetSpecCache()

      const res = await request(app).get('/api/docs')
      expect(res.body.servers[0].url).toBe('https://api.example.com')

      process.env.APP_URL = originalUrl
      resetSpecCache()
    })

    it('serves the spec with application/json content type', async () => {
      const res = await request(app).get('/api/docs')
      expect(res.headers['content-type']).toMatch(/application\/json/)
    })
  })

  describe('Zod → OpenAPI converter', () => {
    it('converts a simple object schema', () => {
      const schema = z.object({
        name: z.string().min(2),
        age: z.number().int().optional(),
      })
      const result = zodToOpenApi(schema)

      expect(result.type).toBe('object')
      expect(result.properties.name.type).toBe('string')
      expect(result.properties.name.minLength).toBe(2)
      expect(result.properties.age.type).toBe('integer')
      expect(result.required).toEqual(['name'])
    })

    it('converts nullable fields to nullable: true (not anyOf with null)', () => {
      const schema = z.object({
        value: z.string().nullable(),
      })
      const result = zodToOpenApi(schema)

      expect(result.properties.value).toEqual({
        type: 'string',
        nullable: true,
      })
      expect(result.properties.value.anyOf).toBeUndefined()
    })

    it('converts optional nullable fields correctly', () => {
      const schema = z.object({
        expiresAt: z.string().datetime().optional().nullable(),
      })
      const result = zodToOpenApi(schema)

      expect(result.properties.expiresAt.nullable).toBe(true)
      expect(result.properties.expiresAt.anyOf).toBeUndefined()
    })

    it('converts enums', () => {
      const schema = z.object({
        role: z.enum(['USER', 'ADMIN']),
      })
      const result = zodToOpenApi(schema)

      expect(result.properties.role).toEqual({
        type: 'string',
        enum: ['USER', 'ADMIN'],
      })
    })

    it('converts arrays', () => {
      const schema = z.object({
        tags: z.array(z.string()),
      })
      const result = zodToOpenApi(schema)

      expect(result.properties.tags.type).toBe('array')
      expect(result.properties.tags.items.type).toBe('string')
    })

    it('strips $schema keyword from the output', () => {
      const schema = z.object({ x: z.string() })
      const result = zodToOpenApi(schema)

      expect(result.$schema).toBeUndefined()
    })

    it('handles transforms by using the pre-transform shape', () => {
      const schema = z.object({
        value: z
          .string()
          .datetime()
          .optional()
          .nullable()
          .transform((v) => v ?? null),
      })
      // Should not throw.
      const result = zodToOpenApi(schema)

      expect(result.properties.value.type).toBe('string')
      expect(result.properties.value.nullable).toBe(true)
    })

    it('handles nested objects with nullable fields', () => {
      const schema = z.object({
        nested: z.object({
          a: z.string().nullable(),
          b: z.number(),
        }),
      })
      const result = zodToOpenApi(schema)

      expect(result.properties.nested.properties.a).toEqual({
        type: 'string',
        nullable: true,
      })
      expect(result.properties.nested.properties.b.type).toBe('number')
    })
  })

  describe('buildSpec — spec builder', () => {
    it('caches the spec on repeated calls', () => {
      const spec1 = buildSpec()
      const spec2 = buildSpec()
      expect(spec1).toBe(spec2)
    })

    it('rebuilds after resetSpecCache', () => {
      const spec1 = buildSpec()
      resetSpecCache()
      const spec2 = buildSpec()
      expect(spec1).not.toBe(spec2)
      expect(spec1).toEqual(spec2)
    })

    it('includes all expected operation methods', () => {
      const spec = buildSpec()
      const methods = new Set()

      for (const pathOps of Object.values(spec.paths)) {
        for (const method of Object.keys(pathOps)) {
          methods.add(method.toUpperCase())
        }
      }

      expect([...methods]).toEqual(expect.arrayContaining(['GET', 'POST', 'PATCH', 'DELETE']))
    })
  })
})
