import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'
import { authorize, requireVerifiedEmail } from '../src/middleware/auth.middleware.js'

// Unique suffix per run so repeated runs against a persistent DB never collide
const RUN_ID = Date.now()
const emailFor = (label) => `test-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdEmails = []
const registerUser = async (label, overrides = {}) => {
  const email = emailFor(label)
  createdEmails.push(email)
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      name: 'Test User',
      email,
      password: VALID_PASSWORD,
      ...overrides,
    })
  return { email, res }
}

afterAll(async () => {
  // RefreshToken records are cascade-deleted with their User, but clean up
  // any stragglers (e.g. users created by tests that pushed emails to createdEmails)
  await prisma.refreshToken.deleteMany({
    where: { user: { email: { in: createdEmails } } },
  })
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } })
  await prisma.$disconnect()
})

describe('POST /api/auth/register', () => {
  it('registers a new user and returns token + refreshToken + verification token', async () => {
    const { res } = await registerUser('register')

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.user.email).toBeDefined()
    expect(res.body.data.token).toBeTypeOf('string')
    expect(res.body.data.refreshToken).toBeTypeOf('string')
    expect(res.body.data.emailVerificationToken).toBeTypeOf('string')
    expect(res.body.data.user.password).toBeUndefined()
  })

  it('rejects duplicate email registration', async () => {
    const { email } = await registerUser('dup')

    const res = await request(app).post('/api/auth/register').send({
      name: 'Test User',
      email,
      password: VALID_PASSWORD,
    })

    expect(res.status).toBe(409)
    expect(res.body.success).toBe(false)
  })

  it('rejects invalid payloads', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'T',
      email: 'not-an-email',
      password: 'short',
    })

    expect(res.status).toBe(400)
    expect(res.body.errors).toBeDefined()
  })
})

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const { email } = await registerUser('login')

    const res = await request(app).post('/api/auth/login').send({ email, password: VALID_PASSWORD })

    expect(res.status).toBe(200)
    expect(res.body.data.token).toBeTypeOf('string')
    expect(res.body.data.refreshToken).toBeTypeOf('string')
  })

  it('rejects incorrect password', async () => {
    const { email } = await registerUser('login-bad')

    const res = await request(app).post('/api/auth/login').send({ email, password: 'WrongPass1' })

    expect(res.status).toBe(401)
    expect(res.body.success).toBe(false)
  })

  it('rejects unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: emailFor('unknown'), password: VALID_PASSWORD })

    expect(res.status).toBe(401)
  })

  it(
    'locks the account after 5 failed attempts',
    async () => {
    const { email } = await registerUser('lockout')

    // Make 5 failed attempts
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/auth/login').send({ email, password: 'WrongPass1' })
      expect(res.status).toBe(401)
    }

    // 6th attempt — even with correct password — should be locked (423)
    const lockedRes = await request(app)
      .post('/api/auth/login')
      .send({ email, password: VALID_PASSWORD })
    expect(lockedRes.status).toBe(423)
    expect(lockedRes.body.message).toMatch(/locked/i)
  },
    15000,
  )
})

describe('GET /api/auth/me', () => {
  it('returns the current user profile when authenticated', async () => {
    const { email, res: registerRes } = await registerUser('me')
    const { token } = registerRes.body.data

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.user.email).toBe(email)
  })

  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('rejects requests with an invalid token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer garbage')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token and invalidates the previous one', async () => {
    const { res: registerRes } = await registerUser('refresh')
    const oldRefreshToken = registerRes.body.data.refreshToken

    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: oldRefreshToken })

    expect(res.status).toBe(200)
    expect(res.body.data.token).toBeTypeOf('string')
    expect(res.body.data.refreshToken).toBeTypeOf('string')
    expect(res.body.data.refreshToken).not.toBe(oldRefreshToken)

    // Old refresh token must no longer work — and because reuse detection revokes
    // the entire token family, the new token is also revoked.
    const reuseRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: oldRefreshToken })
    expect(reuseRes.status).toBe(401)

    // New refresh token is also revoked (reuse detection revokes all tokens)
    const newRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: res.body.data.refreshToken })
    expect(newRes.status).toBe(401)
  })

  it('rejects an invalid refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' })
    expect(res.status).toBe(401)
  })

  it('supports multiple concurrent sessions (multi-device)', async () => {
    const { email } = await registerUser('multi-session')

    // Log in from two different "devices"
    const login1 = await request(app)
      .post('/api/auth/login')
      .send({ email, password: VALID_PASSWORD })
    const login2 = await request(app)
      .post('/api/auth/login')
      .send({ email, password: VALID_PASSWORD })

    expect(login1.status).toBe(200)
    expect(login2.status).toBe(200)
    expect(login1.body.data.refreshToken).not.toBe(login2.body.data.refreshToken)

    // Both refresh tokens should work independently
    const refresh1 = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: login1.body.data.refreshToken })
    expect(refresh1.status).toBe(200)

    const refresh2 = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: login2.body.data.refreshToken })
    expect(refresh2.status).toBe(200)
  })

  it('revokes all tokens when a reused (revoked) refresh token is detected', async () => {
    const { email } = await registerUser('reuse-detect')

    // Log in to get a refresh token
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email, password: VALID_PASSWORD })
    const originalRefreshToken = login.body.data.refreshToken

    // Rotate the token (normal use)
    const rotateRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: originalRefreshToken })
    expect(rotateRes.status).toBe(200)
    const newRefreshToken = rotateRes.body.data.refreshToken

    // Now try to reuse the OLD (revoked) token — this should trigger
    // reuse detection and revoke ALL tokens for this user
    const reuseRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: originalRefreshToken })
    expect(reuseRes.status).toBe(401)

    // The NEW token should also be revoked now (compromise signal)
    const newTokenRes = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: newRefreshToken })
    expect(newTokenRes.status).toBe(401)
  })
})

describe('POST /api/auth/verify-email', () => {
  it('verifies email with a valid token', async () => {
    const { res: registerRes } = await registerUser('verify')
    const { emailVerificationToken } = registerRes.body.data

    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: emailVerificationToken })

    expect(res.status).toBe(200)
    expect(res.body.data.message).toMatch(/verified successfully/i)
  })

  it('rejects an invalid verification token', async () => {
    const res = await request(app).post('/api/auth/verify-email').send({ token: 'invalid-token' })
    expect(res.status).toBe(400)
  })

  it('rejects an expired verification token', async () => {
    const { res: registerRes } = await registerUser('verify-expired')
    const origToken = registerRes.body.data.emailVerificationToken

    // Manually expire the token in the DB
    const dbUser = await prisma.user.findUnique({ where: { email: emailFor('verify-expired') } })
    await prisma.user.update({
      where: { id: dbUser.id },
      data: { emailVerificationExpires: new Date(Date.now() - 1000) },
    })

    const res = await request(app).post('/api/auth/verify-email').send({ token: origToken })
    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/expired/i)

    // The stale token should be cleared from the DB
    const cleared = await prisma.user.findUnique({ where: { id: dbUser.id } })
    expect(cleared.emailVerificationToken).toBeNull()
    expect(cleared.emailVerificationExpires).toBeNull()
  })
})

describe('POST /api/auth/resend-verification', () => {
  it('issues a new verification token for an unverified account', async () => {
    const { email } = await registerUser('resend')

    const res = await request(app).post('/api/auth/resend-verification').send({ email })

    expect(res.status).toBe(200)
    expect(res.body.data.emailVerificationToken).toBeTypeOf('string')
  })

  it('does not leak account existence for unknown emails', async () => {
    const res = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: emailFor('unknown-resend') })

    expect(res.status).toBe(200)
    expect(res.body.data.emailVerificationToken).toBeUndefined()
  })
})

describe('POST /api/auth/forgot-password + reset-password', () => {
  it('resets the password with a valid token and invalidates it afterward', async () => {
    const { email } = await registerUser('reset')

    const forgotRes = await request(app).post('/api/auth/forgot-password').send({ email })
    expect(forgotRes.status).toBe(200)
    const { resetToken } = forgotRes.body.data
    expect(resetToken).toBeTypeOf('string')

    const newPassword = 'NewPassword123'
    const resetRes = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword })
    expect(resetRes.status).toBe(200)

    // Old password no longer works, new password does
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email, password: VALID_PASSWORD })
    expect(oldLogin.status).toBe(401)

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email, password: newPassword })
    expect(newLogin.status).toBe(200)

    // Token cannot be reused
    const reuseRes = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: 'AnotherPass123' })
    expect(reuseRes.status).toBe(400)
  })

  it('rejects an invalid reset token', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'bogus-token', newPassword: 'SomePass123' })
    expect(res.status).toBe(400)
  })

  it('does not leak account existence for unknown emails', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: emailFor('unknown-forgot') })

    expect(res.status).toBe(200)
    expect(res.body.data.resetToken).toBeUndefined()
  })
})

describe('POST /api/auth/change-password', () => {
  it('changes the password when current password is correct', async () => {
    const { email, res: registerRes } = await registerUser('change-pw')
    const { token, refreshToken } = registerRes.body.data

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: VALID_PASSWORD, newPassword: 'ChangedPass123' })

    expect(res.status).toBe(200)

    // Old access token should be invalidated (tokenVersion incremented)
    const meRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
    expect(meRes.status).toBe(401)

    // Old refresh token should be revoked
    const refreshRes = await request(app).post('/api/auth/refresh').send({ refreshToken })
    expect(refreshRes.status).toBe(401)

    // New password works
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'ChangedPass123' })
    expect(login.status).toBe(200)
  }, 15000)

  it('rejects an incorrect current password', async () => {
    const { res: registerRes } = await registerUser('change-pw-bad')
    const { token } = registerRes.body.data

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'WrongCurrent1', newPassword: 'ChangedPass123' })

    expect(res.status).toBe(401)
  })

  it('rejects reusing the same password', async () => {
    const { res: registerRes } = await registerUser('change-pw-same')
    const { token } = registerRes.body.data

    const res = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: VALID_PASSWORD, newPassword: VALID_PASSWORD })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/different/i)
  })
})

describe('POST /api/auth/change-email', () => {
  it('stores pending email and sends verification token without changing email immediately', async () => {
    const { email, res: registerRes } = await registerUser('change-email')
    const { token } = registerRes.body.data
    const newEmail = emailFor('change-email-new')
    createdEmails.push(newEmail)

    const res = await request(app)
      .post('/api/auth/change-email')
      .set('Authorization', `Bearer ${token}`)
      .send({ newEmail, password: VALID_PASSWORD })

    expect(res.status).toBe(200)
    expect(res.body.data.emailVerificationToken).toBeTypeOf('string')
    expect(res.body.data.message).toMatch(/verification email sent/i)

    // Email should NOT have changed yet
    const meRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
    expect(meRes.body.data.user.email).toBe(email)
  })

  it('completes email change after verification', async () => {
    const { res: registerRes } = await registerUser('change-email-verify')
    const { token } = registerRes.body.data
    const newEmail = emailFor('change-email-verify-new')
    createdEmails.push(newEmail)

    const changeRes = await request(app)
      .post('/api/auth/change-email')
      .set('Authorization', `Bearer ${token}`)
      .send({ newEmail, password: VALID_PASSWORD })

    const verifyRes = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: changeRes.body.data.emailVerificationToken })

    expect(verifyRes.status).toBe(200)

    // Email should now be the new email
    const meRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
    expect(meRes.body.data.user.email).toBe(newEmail)
  })

  it('rejects an email already in use', async () => {
    const { email: takenEmail } = await registerUser('change-email-taken')
    const { res: registerRes } = await registerUser('change-email-from')
    const { token } = registerRes.body.data

    const res = await request(app)
      .post('/api/auth/change-email')
      .set('Authorization', `Bearer ${token}`)
      .send({ newEmail: takenEmail, password: VALID_PASSWORD })

    expect(res.status).toBe(409)
  })
})

describe('POST /api/auth/logout', () => {
  it('invalidates the specific refresh token when provided', async () => {
    const { res: registerRes } = await registerUser('logout')
    const { token, refreshToken } = registerRes.body.data

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .send({ refreshToken })
    expect(res.status).toBe(200)

    const refreshRes = await request(app).post('/api/auth/refresh').send({ refreshToken })
    expect(refreshRes.status).toBe(401)
  })

  it('revokes all refresh tokens when no token is provided (logout everywhere)', async () => {
    const { email } = await registerUser('logout-all')

    // Create two sessions
    const login1 = await request(app)
      .post('/api/auth/login')
      .send({ email, password: VALID_PASSWORD })
    const login2 = await request(app)
      .post('/api/auth/login')
      .send({ email, password: VALID_PASSWORD })

    // Logout everywhere (no refreshToken in body)
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${login1.body.data.token}`)
    expect(res.status).toBe(200)

    // Both refresh tokens should be revoked
    const r1 = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: login1.body.data.refreshToken })
    const r2 = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: login2.body.data.refreshToken })
    expect(r1.status).toBe(401)
    expect(r2.status).toBe(401)
  })
})

describe('authorize() middleware', () => {
  const buildRes = () => {
    const res = {}
    res.status = (code) => {
      res.statusCode = code
      return res
    }
    res.json = (body) => {
      res.body = body
      return res
    }
    return res
  }

  it('calls next() when the user has an allowed role', () => {
    const req = { user: { id: '1', role: 'ADMIN' } }
    const res = buildRes()
    let called = false

    authorize('ADMIN')(req, res, () => {
      called = true
    })

    expect(called).toBe(true)
  })

  it('returns 403 when the user role is not allowed', () => {
    const req = { user: { id: '1', role: 'USER' } }
    const res = buildRes()

    authorize('ADMIN')(req, res, () => {})

    expect(res.statusCode).toBe(403)
  })

  it('returns 401 when there is no authenticated user', () => {
    const req = {}
    const res = buildRes()

    authorize('ADMIN')(req, res, () => {})

    expect(res.statusCode).toBe(401)
  })
})

describe('requireVerifiedEmail() middleware', () => {
  const buildRes = () => {
    const res = {}
    res.status = (code) => {
      res.statusCode = code
      return res
    }
    res.json = (body) => {
      res.body = body
      return res
    }
    return res
  }

  it('returns 401 when there is no authenticated user', async () => {
    const req = {}
    const res = buildRes()

    await requireVerifiedEmail(req, res, () => {})

    expect(res.statusCode).toBe(401)
  })

  it('returns 403 when the user email is not verified', async () => {
    const { res: registerRes } = await registerUser('require-verified')
    const req = { user: { id: registerRes.body.data.user.id } }
    const res = buildRes()

    await requireVerifiedEmail(req, res, () => {})

    expect(res.statusCode).toBe(403)
    expect(res.body.message).toMatch(/not verified/i)
  })

  it('calls next() when the user email is verified', async () => {
    const { res: registerRes } = await registerUser('require-verified-ok')
    await request(app)
      .post('/api/auth/verify-email')
      .send({ token: registerRes.body.data.emailVerificationToken })

    const req = { user: { id: registerRes.body.data.user.id } }
    const res = buildRes()
    let called = false

    await requireVerifiedEmail(req, res, () => {
      called = true
    })

    expect(called).toBe(true)
  })
})

describe('verifyEmail pending-email race condition (F3)', () => {
  it('returns 409 when pendingEmail was claimed by another user', async () => {
    // User A requests email change to newemail@example.com
    const { res: resA } = await registerUser('race-user-a')
    const tokenA = resA.body.data.token
    const userIdA = resA.body.data.user.id

    const newEmail = emailFor('race-new-email')

    const changeRes = await request(app)
      .post('/api/auth/change-email')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ newEmail, password: VALID_PASSWORD })

    expect(changeRes.status).toBe(200)
    const verificationToken = changeRes.body.data.emailVerificationToken

    // User B registers with the same email before A verifies
    await registerUser('race-user-b', { email: newEmail })
    createdEmails.push(newEmail)

    // User A tries to verify — should get 409
    const verifyRes = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: verificationToken })

    expect(verifyRes.status).toBe(409)
    expect(verifyRes.body.message).toMatch(/already in use/i)

    // Clean up pendingEmail so user can be deleted
    await prisma.user.update({
      where: { id: userIdA },
      data: { pendingEmail: null, emailVerificationToken: null, emailVerificationExpires: null },
    })
  })
})
