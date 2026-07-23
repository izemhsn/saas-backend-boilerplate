import { describe, it, expect, afterAll, vi } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'

// Set Google env vars before modules read them
vi.stubEnv('GOOGLE_CLIENT_ID', 'test-google-client-id')
vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-google-client-secret')
vi.stubEnv('GOOGLE_REDIRECT_URI', 'postmessage')

let currentPayload = {
  sub: 'google-123456789',
  email: 'test-google@example.com',
  email_verified: true,
  name: 'Google Test User',
}

// Mock google-auth-library so no real Google API calls are made
vi.mock('google-auth-library', () => {
  class OAuth2Client {
    getToken(code) {
      if (code === 'invalid-token') {
        return Promise.reject(new Error('Invalid authorization code'))
      }
      return Promise.resolve({
        tokens: { id_token: 'fake-id-token', access_token: 'fake-access-token' },
      })
    }
    verifyIdToken({ idToken }) {
      if (idToken === 'invalid-token') {
        return Promise.reject(new Error('Invalid token'))
      }
      return Promise.resolve({
        getPayload: () => currentPayload,
      })
    }
    generateAuthUrl() {
      return 'https://accounts.google.com/o/oauth2/auth?scope=openid+email+profile'
    }
  }
  return { OAuth2Client }
})

const RUN_ID = Date.now()
const emailFor = (label) => `test-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdEmails = []
const createdGoogleIds = []

const cleanupUser = async (email) => {
  await prisma.refreshToken.deleteMany({
    where: { user: { email } },
  })
  await prisma.user.deleteMany({ where: { email } })
}

afterAll(async () => {
  for (const email of createdEmails) {
    await cleanupUser(email)
  }
  // Clean up any google-only users by googleId
  if (createdGoogleIds.length) {
    await prisma.refreshToken.deleteMany({
      where: { user: { googleId: { in: createdGoogleIds } } },
    })
    await prisma.user.deleteMany({ where: { googleId: { in: createdGoogleIds } } })
  }
  await prisma.$disconnect()
})

describe('GET /api/auth/google', () => {
  it('returns a Google OAuth URL', async () => {
    const res = await request(app).get('/api/auth/google')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.url).toContain('accounts.google.com')
  })
})

describe('POST /api/auth/google', () => {
  it('creates a new user from Google profile and returns tokens', async () => {
    const googleId = `google-new-${RUN_ID}`
    const googleEmail = emailFor('google-new')
    createdGoogleIds.push(googleId)
    createdEmails.push(googleEmail)

    currentPayload = {
      sub: googleId,
      email: googleEmail,
      email_verified: true,
      name: 'New Google User',
    }

    const res = await request(app).post('/api/auth/google').send({ code: 'valid-auth-code' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.user.email).toBe(googleEmail)
    expect(res.body.data.token).toBeTypeOf('string')
    expect(res.body.data.refreshToken).toBeTypeOf('string')
    expect(res.body.data.user.password).toBeUndefined()
  })

  it('logs in existing Google user on subsequent sign-in', async () => {
    const googleId = `google-return-${RUN_ID}`
    const googleEmail = emailFor('google-return')
    createdGoogleIds.push(googleId)
    createdEmails.push(googleEmail)

    currentPayload = {
      sub: googleId,
      email: googleEmail,
      email_verified: true,
      name: 'Return Google User',
    }

    // First sign-in — creates the user
    const first = await request(app).post('/api/auth/google').send({ code: 'valid-auth-code' })
    expect(first.status).toBe(200)

    // Second sign-in — should log in the same user
    const second = await request(app).post('/api/auth/google').send({ code: 'valid-auth-code' })
    expect(second.status).toBe(200)
    expect(second.body.data.user.email).toBe(googleEmail)
    expect(second.body.data.user.id).toBe(first.body.data.user.id)
  })

  it('links Google account to existing email-based user', async () => {
    const googleId = `google-link-${RUN_ID}`
    const googleEmail = emailFor('google-link')
    createdGoogleIds.push(googleId)
    createdEmails.push(googleEmail)

    // Register a normal user first
    await request(app).post('/api/auth/register').send({
      name: 'Link Test',
      email: googleEmail,
      password: VALID_PASSWORD,
    })

    // Now sign in with Google using the same email
    currentPayload = {
      sub: googleId,
      email: googleEmail,
      email_verified: true,
      name: 'Link Test',
    }

    const res = await request(app).post('/api/auth/google').send({ code: 'valid-auth-code' })

    expect(res.status).toBe(200)
    expect(res.body.data.user.email).toBe(googleEmail)

    // Verify googleId was set on the user
    const dbUser = await prisma.user.findUnique({
      where: { email: googleEmail },
      select: { googleId: true },
    })
    expect(dbUser.googleId).toBe(googleId)
  })

  it('rejects invalid authorization code', async () => {
    const res = await request(app).post('/api/auth/google').send({ code: 'invalid-token' })

    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/Failed to authenticate with Google/)
  })

  it('rejects missing code in payload', async () => {
    const res = await request(app).post('/api/auth/google').send({})

    expect(res.status).toBe(400)
    expect(res.body.errors).toBeDefined()
  })

  it('rejects login for OAuth-only user via password login', async () => {
    const googleId = `google-pwreject-${RUN_ID}`
    const googleEmail = emailFor('google-pwreject')
    createdGoogleIds.push(googleId)
    createdEmails.push(googleEmail)

    currentPayload = {
      sub: googleId,
      email: googleEmail,
      email_verified: true,
      name: 'PW Reject User',
    }

    // Create user via Google
    await request(app).post('/api/auth/google').send({ code: 'valid-auth-code' })

    // Try to log in with password — should be rejected
    const res = await request(app).post('/api/auth/login').send({
      email: googleEmail,
      password: VALID_PASSWORD,
    })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Google/)
  })

  it('rejects banned user from Google login', async () => {
    const googleId = `google-banned-${RUN_ID}`
    const googleEmail = emailFor('google-banned')
    createdGoogleIds.push(googleId)
    createdEmails.push(googleEmail)

    currentPayload = {
      sub: googleId,
      email: googleEmail,
      email_verified: true,
      name: 'Banned User',
    }

    // Create user via Google
    const createRes = await request(app).post('/api/auth/google').send({ code: 'valid-auth-code' })
    expect(createRes.status).toBe(200)

    // Ban the user directly in DB
    await prisma.user.update({
      where: { id: createRes.body.data.user.id },
      data: { banned: true },
    })

    // Try to log in again
    const res = await request(app).post('/api/auth/google').send({ code: 'valid-auth-code' })

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/banned/)
  })
})
