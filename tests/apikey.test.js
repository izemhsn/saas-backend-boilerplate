import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'
import { verifyApiKey, generateRawKey } from '../src/modules/apikey/apikey.service.js'

const RUN_ID = Date.now()
const emailFor = (label) => `apikey-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdEmails = []
const createdUserIds = []
const createdKeyIds = []

const registerUser = async (label, overrides = {}) => {
  const email = emailFor(label)
  createdEmails.push(email)
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test User', email, password: VALID_PASSWORD, ...overrides })
  createdUserIds.push(res.body.data.user.id)
  return { email, res }
}

afterAll(async () => {
  await prisma.apiKey.deleteMany({ where: { id: { in: createdKeyIds } } })
  await prisma.refreshToken.deleteMany({
    where: { user: { email: { in: createdEmails } } },
  })
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } })
  await prisma.$disconnect()
})

describe('POST /api/api-keys', () => {
  it('creates an API key and returns the raw key once', async () => {
    const { res: registerRes } = await registerUser('create')
    const { token } = registerRes.body.data

    const res = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'My API Key', scopes: ['read:projects'] })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.apiKey).toBeDefined()
    expect(res.body.data.apiKey.id).toBeDefined()
    expect(res.body.data.apiKey.keyPrefix).toMatch(/^sk_/)
    expect(res.body.data.apiKey.scopes).toEqual(['read:projects'])
    expect(res.body.data.key).toMatch(/^sk_/)
    expect(res.body.data.key).not.toBe(res.body.data.apiKey.keyPrefix)
    createdKeyIds.push(res.body.data.apiKey.id)
  })

  it('creates a key with empty scopes by default', async () => {
    const { res: registerRes } = await registerUser('default-scopes')
    const { token } = registerRes.body.data

    const res = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Default Key' })

    expect(res.status).toBe(201)
    expect(res.body.data.apiKey.scopes).toEqual([])
    createdKeyIds.push(res.body.data.apiKey.id)
  })

  it('rejects without authentication', async () => {
    const res = await request(app).post('/api/api-keys').send({ name: 'No Auth' })

    expect(res.status).toBe(401)
  })

  it('rejects empty name', async () => {
    const { res: registerRes } = await registerUser('bad-name')
    const { token } = registerRes.body.data

    const res = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '' })

    expect(res.status).toBe(400)
    expect(res.body.errors).toBeDefined()
  })
})

describe('GET /api/api-keys', () => {
  it('lists the user API keys without exposing the raw key', async () => {
    const { res: registerRes } = await registerUser('list')
    const { token } = registerRes.body.data

    const createRes = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Listable Key', scopes: ['read:projects'] })
    createdKeyIds.push(createRes.body.data.apiKey.id)

    const res = await request(app)
      .get('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.apiKeys.length).toBeGreaterThanOrEqual(1)
    expect(res.body.data.pagination).toBeDefined()
    // Raw key should never appear in list
    expect(JSON.stringify(res.body.data)).not.toContain(createRes.body.data.key)
  })

  it('only returns keys belonging to the authenticated user', async () => {
    const { res: res1 } = await registerUser('list-owner1')
    const { res: res2 } = await registerUser('list-owner2')
    const token1 = res1.body.data.token
    const token2 = res2.body.data.token

    const createRes = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${token1}`)
      .send({ name: 'Owner1 Key' })
    createdKeyIds.push(createRes.body.data.apiKey.id)

    const res = await request(app)
      .get('/api/api-keys')
      .set('Authorization', `Bearer ${token2}`)

    expect(res.status).toBe(200)
    expect(res.body.data.apiKeys.find((k) => k.id === createRes.body.data.apiKey.id)).toBeUndefined()
  })
})

describe('GET /api/api-keys/:keyId', () => {
  it('returns a single key by ID', async () => {
    const { res: registerRes } = await registerUser('get-one')
    const { token } = registerRes.body.data

    const createRes = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Get One Key' })
    const keyId = createRes.body.data.apiKey.id
    createdKeyIds.push(keyId)

    const res = await request(app)
      .get(`/api/api-keys/${keyId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.apiKey.id).toBe(keyId)
    expect(res.body.data.apiKey.name).toBe('Get One Key')
  })

  it('returns 404 for non-existent key', async () => {
    const { res: registerRes } = await registerUser('get-404')
    const { token } = registerRes.body.data

    const res = await request(app)
      .get('/api/api-keys/nonexistent-id')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})

describe('POST /api/api-keys/:keyId/revoke', () => {
  it('revokes an active API key', async () => {
    const { res: registerRes } = await registerUser('revoke')
    const { token } = registerRes.body.data

    const createRes = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'To Revoke' })
    const keyId = createRes.body.data.apiKey.id
    createdKeyIds.push(keyId)

    const res = await request(app)
      .post(`/api/api-keys/${keyId}/revoke`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.apiKey.revokedAt).not.toBeNull()
  })

  it('rejects revoking an already revoked key', async () => {
    const { res: registerRes } = await registerUser('revoke-twice')
    const { token } = registerRes.body.data

    const createRes = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Revoke Twice' })
    const keyId = createRes.body.data.apiKey.id
    createdKeyIds.push(keyId)

    await request(app)
      .post(`/api/api-keys/${keyId}/revoke`)
      .set('Authorization', `Bearer ${token}`)

    const res = await request(app)
      .post(`/api/api-keys/${keyId}/revoke`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/api-keys/:keyId', () => {
  it('deletes an API key permanently', async () => {
    const { res: registerRes } = await registerUser('delete')
    const { token } = registerRes.body.data

    const createRes = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'To Delete' })
    const keyId = createRes.body.data.apiKey.id

    const res = await request(app)
      .delete(`/api/api-keys/${keyId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)

    const getRes = await request(app)
      .get(`/api/api-keys/${keyId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(getRes.status).toBe(404)
  })
})

describe('verifyApiKey (service-level)', () => {
  it('verifies a valid key and returns user info', async () => {
    const { res: registerRes } = await registerUser('verify')
    const userId = registerRes.body.data.user.id

    const { apiKey, key } = await import('../src/modules/apikey/apikey.service.js').then((m) =>
      m.createApiKey(userId, { name: 'Verify Key', scopes: ['read:projects'] }),
    )
    createdKeyIds.push(apiKey.id)

    const result = await verifyApiKey(key)
    expect(result).not.toBeNull()
    expect(result.userId).toBe(userId)
    expect(result.scopes).toEqual(['read:projects'])
    expect(result.user.id).toBe(userId)
  })

  it('returns null for a revoked key', async () => {
    const { res: registerRes } = await registerUser('verify-revoked')
    const userId = registerRes.body.data.user.id

    const { apiKey, key } = await import('../src/modules/apikey/apikey.service.js').then((m) =>
      m.createApiKey(userId, { name: 'Revoke Verify' }),
    )
    createdKeyIds.push(apiKey.id)

    await import('../src/modules/apikey/apikey.service.js').then((m) =>
      m.revokeApiKey(userId, apiKey.id),
    )

    const result = await verifyApiKey(key)
    expect(result).toBeNull()
  })

  it('returns null for an expired key', async () => {
    const { res: registerRes } = await registerUser('verify-expired')
    const userId = registerRes.body.data.user.id

    const { apiKey, key } = await import('../src/modules/apikey/apikey.service.js').then((m) =>
      m.createApiKey(userId, {
        name: 'Expired Key',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    )
    createdKeyIds.push(apiKey.id)

    const result = await verifyApiKey(key)
    expect(result).toBeNull()
  })

  it('returns null for a non-existent key', async () => {
    const result = await verifyApiKey('sk_nonexistentkey123456')
    expect(result).toBeNull()
  })

  it('returns null for a key without the correct prefix', async () => {
    const result = await verifyApiKey('invalid-key-format')
    expect(result).toBeNull()
  })

  it('returns null for an empty string', async () => {
    const result = await verifyApiKey('')
    expect(result).toBeNull()
  })
})

describe('generateRawKey', () => {
  it('generates a key with the sk_ prefix', () => {
    const key = generateRawKey()
    expect(key).toMatch(/^sk_[a-f0-9]{64}$/)
  })

  it('generates unique keys', () => {
    const keys = new Set()
    for (let i = 0; i < 100; i++) {
      keys.add(generateRawKey())
    }
    expect(keys.size).toBe(100)
  })
})
