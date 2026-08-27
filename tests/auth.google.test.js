import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
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

// H4 — POST /api/auth/google now requires the `state` issued by GET
// /api/auth/google (login-CSRF defense). It's stateless and not single-use
// (see utils/oauthState.js), so one fetched here is reused across every test
// below instead of round-tripping GET before each POST.
let VALID_STATE

beforeAll(async () => {
  const res = await request(app).get('/api/auth/google')
  VALID_STATE = res.body.data.state
})

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
  it('returns a Google OAuth URL and a state token', async () => {
    const res = await request(app).get('/api/auth/google')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.url).toContain('accounts.google.com')
    expect(res.body.data.state).toBeTypeOf('string')
    expect(res.body.data.state.length).toBeGreaterThan(0)
  })

  it('returns a fresh state on every call', async () => {
    const first = await request(app).get('/api/auth/google')
    const second = await request(app).get('/api/auth/google')

    expect(first.body.data.state).not.toBe(second.body.data.state)
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

    const res = await request(app)
      .post('/api/auth/google')
      .send({ code: 'valid-auth-code', state: VALID_STATE })

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
    const first = await request(app)
      .post('/api/auth/google')
      .send({ code: 'valid-auth-code', state: VALID_STATE })
    expect(first.status).toBe(200)

    // Second sign-in — should log in the same user
    const second = await request(app)
      .post('/api/auth/google')
      .send({ code: 'valid-auth-code', state: VALID_STATE })
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

    const res = await request(app)
      .post('/api/auth/google')
      .send({ code: 'valid-auth-code', state: VALID_STATE })

    expect(res.status).toBe(200)
    expect(res.body.data.user.email).toBe(googleEmail)

    // Verify googleId was set on the user
    const dbUser = await prisma.user.findFirst({
      where: { email: googleEmail },
      select: { googleId: true },
    })
    expect(dbUser.googleId).toBe(googleId)
  })

  it('rejects invalid authorization code', async () => {
    const res = await request(app)
      .post('/api/auth/google')
      .send({ code: 'invalid-token', state: VALID_STATE })

    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/Failed to authenticate with Google/)
  })

  it('rejects missing code in payload', async () => {
    const res = await request(app).post('/api/auth/google').send({})

    expect(res.status).toBe(400)
    expect(res.body.errors).toBeDefined()
  })

  // H4 — login CSRF. Without a required, verified `state`, an attacker who
  // captures a valid `code` for their own Google account could trick a
  // victim's browser into completing this exchange on the attacker's behalf.
  it('rejects missing state', async () => {
    const res = await request(app).post('/api/auth/google').send({ code: 'valid-auth-code' })

    expect(res.status).toBe(400)
    expect(res.body.errors).toBeDefined()
  })

  it('rejects a tampered state', async () => {
    const res = await request(app)
      .post('/api/auth/google')
      .send({ code: 'valid-auth-code', state: `${VALID_STATE}x` })

    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/invalid|expired/i)
  })

  it('rejects a state signed with the wrong secret', async () => {
    const res = await request(app)
      .post('/api/auth/google')
      .send({ code: 'valid-auth-code', state: 'nonce.9999999999999.deadbeef' })

    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/invalid|expired/i)
  })

  it('rejects an expired state', async () => {
    // Same format as a real state (nonce.expiresAt.signature) but with an
    // expiresAt in the past — the signature won't match (it's not really
    // signed), which exercises the same rejection path as a forged token.
    const res = await request(app)
      .post('/api/auth/google')
      .send({ code: 'valid-auth-code', state: `deadbeef.${Date.now() - 1000}.deadbeef` })

    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/invalid|expired/i)
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
    await request(app)
      .post('/api/auth/google')
      .send({ code: 'valid-auth-code', state: VALID_STATE })

    // Try to log in with password — should be rejected
    const res = await request(app).post('/api/auth/login').send({
      email: googleEmail,
      password: VALID_PASSWORD,
    })

    // M3: this used to be a distinct 400 "created with Google" response, which
    // was an account-existence oracle. It now falls through to the same
    // generic 401 as any other wrong-credentials login.
    expect(res.status).toBe(401)
  })

  // H1 — Google only guarantees the `email` claim when `email_verified` is
  // true. Because a matching email links this identity onto an existing local
  // account, accepting an unverified claim would be an account-takeover path.
  it('rejects a Google profile whose email is not verified', async () => {
    const googleId = `google-unverified-${RUN_ID}`
    const googleEmail = emailFor('google-unverified')
    createdGoogleIds.push(googleId)
    createdEmails.push(googleEmail)

    currentPayload = {
      sub: googleId,
      email: googleEmail,
      email_verified: false,
      name: 'Unverified Google User',
    }

    const res = await request(app)
      .post('/api/auth/google')
      .send({ code: 'valid-auth-code', state: VALID_STATE })

    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/not verified/i)

    // No account may be created from an unverified claim
    const dbUser = await prisma.user.findFirst({ where: { email: googleEmail } })
    expect(dbUser).toBeNull()
  })

  it('rejects a Google profile with email_verified missing entirely', async () => {
    const googleId = `google-noverif-${RUN_ID}`
    const googleEmail = emailFor('google-noverif')
    createdGoogleIds.push(googleId)
    createdEmails.push(googleEmail)

    currentPayload = { sub: googleId, email: googleEmail, name: 'No Verif Claim' }

    const res = await request(app)
      .post('/api/auth/google')
      .send({ code: 'valid-auth-code', state: VALID_STATE })

    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/not verified/i)
  })

  it('does not link an unverified Google email onto an existing password account', async () => {
    const googleId = `google-takeover-${RUN_ID}`
    const victimEmail = emailFor('google-takeover')
    createdGoogleIds.push(googleId)
    createdEmails.push(victimEmail)

    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Victim', email: victimEmail, password: VALID_PASSWORD })

    // Attacker-controlled Google identity asserting the victim's address
    currentPayload = {
      sub: googleId,
      email: victimEmail,
      email_verified: false,
      name: 'Attacker',
    }

    const res = await request(app)
      .post('/api/auth/google')
      .send({ code: 'valid-auth-code', state: VALID_STATE })

    expect(res.status).toBe(401)

    // The victim's account must be untouched — no googleId linked
    const dbUser = await prisma.user.findFirst({
      where: { email: victimEmail },
      select: { googleId: true },
    })
    expect(dbUser.googleId).toBeNull()
  })

  // C1 — Google sign-in must not be a second-factor bypass.
  it('returns a 2FA challenge instead of tokens when the user has 2FA enabled', async () => {
    const googleId = `google-2fa-${RUN_ID}`
    const googleEmail = emailFor('google-2fa')
    createdGoogleIds.push(googleId)
    createdEmails.push(googleEmail)

    currentPayload = {
      sub: googleId,
      email: googleEmail,
      email_verified: true,
      name: '2FA Google User',
    }

    // First sign-in creates the account and returns tokens
    const first = await request(app)
      .post('/api/auth/google')
      .send({ code: 'valid-auth-code', state: VALID_STATE })
    expect(first.status).toBe(200)
    expect(first.body.data.token).toBeTypeOf('string')

    // Turn on 2FA directly in the DB — this test is about the OAuth gate, not
    // the enrolment flow (covered in twofa.test.js)
    await prisma.user.update({
      where: { id: first.body.data.user.id },
      data: { twoFactorEnabled: true, twoFactorSecret: 'JBSWY3DPEHPK3PXP' },
    })

    const res = await request(app)
      .post('/api/auth/google')
      .send({ code: 'valid-auth-code', state: VALID_STATE })

    expect(res.status).toBe(200)
    expect(res.body.data.twoFactorRequired).toBe(true)
    expect(res.body.data.challengeToken).toBeTypeOf('string')
    // Crucially: no usable credentials are issued
    expect(res.body.data.token).toBeUndefined()
    expect(res.body.data.refreshToken).toBeUndefined()
    expect(res.body.data.user).toBeUndefined()
  })

  it('still enforces the ban check ahead of the 2FA challenge', async () => {
    const googleId = `google-2fa-banned-${RUN_ID}`
    const googleEmail = emailFor('google-2fa-banned')
    createdGoogleIds.push(googleId)
    createdEmails.push(googleEmail)

    currentPayload = {
      sub: googleId,
      email: googleEmail,
      email_verified: true,
      name: 'Banned 2FA User',
    }

    const first = await request(app)
      .post('/api/auth/google')
      .send({ code: 'valid-auth-code', state: VALID_STATE })
    expect(first.status).toBe(200)

    await prisma.user.update({
      where: { id: first.body.data.user.id },
      data: { twoFactorEnabled: true, twoFactorSecret: 'JBSWY3DPEHPK3PXP', banned: true },
    })

    const res = await request(app)
      .post('/api/auth/google')
      .send({ code: 'valid-auth-code', state: VALID_STATE })

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/banned/)
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
    const createRes = await request(app)
      .post('/api/auth/google')
      .send({ code: 'valid-auth-code', state: VALID_STATE })
    expect(createRes.status).toBe(200)

    // Ban the user directly in DB
    await prisma.user.update({
      where: { id: createRes.body.data.user.id },
      data: { banned: true },
    })

    // Try to log in again
    const res = await request(app)
      .post('/api/auth/google')
      .send({ code: 'valid-auth-code', state: VALID_STATE })

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/banned/)
  })
})
