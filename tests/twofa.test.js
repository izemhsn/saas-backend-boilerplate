import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import { generate } from 'otplib'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'
import { decryptSecret } from '../src/utils/secretCrypto.js'

const RUN_ID = Date.now()
const emailFor = (label) => `test-2fa-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdEmails = []

const registerUser = async (label, overrides = {}) => {
  const email = emailFor(label)
  createdEmails.push(email)
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test User', email, password: VALID_PASSWORD, ...overrides })
  return { email, res }
}

const login = async (email, password = VALID_PASSWORD) => {
  return request(app).post('/api/auth/login').send({ email, password })
}

afterAll(async () => {
  await prisma.twoFactorChallenge.deleteMany({
    where: { user: { email: { in: createdEmails } } },
  })
  await prisma.refreshToken.deleteMany({
    where: { user: { email: { in: createdEmails } } },
  })
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } })
  await prisma.$disconnect()
})

describe('Two-factor authentication', () => {
  describe('POST /api/auth/2fa/setup', () => {
    it('requires authentication', async () => {
      const res = await request(app).post('/api/auth/2fa/setup')
      expect(res.status).toBe(401)
    })

    it('generates a secret and QR code', async () => {
      const { res: reg } = await registerUser('setup')
      const token = reg.body.data.token

      const res = await request(app)
        .post('/api/auth/2fa/setup')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.secret).toBeTypeOf('string')
      expect(res.body.data.qrCode).toMatch(/^data:image\/png;base64,/)
      expect(res.body.data.otpauth).toContain('otpauth://')
    })

    it('rejects setup if 2FA is already enabled', async () => {
      const { email, res: reg } = await registerUser('setup-already')
      const token = reg.body.data.token

      // Setup
      await request(app).post('/api/auth/2fa/setup').set('Authorization', `Bearer ${token}`)

      // Enable
      const user = await prisma.user.findFirst({ where: { email } })
      const code = await generate({ secret: decryptSecret(user.twoFactorSecret) })
      await request(app)
        .post('/api/auth/2fa/enable')
        .set('Authorization', `Bearer ${token}`)
        .send({ code })

      // Try setup again
      const res = await request(app)
        .post('/api/auth/2fa/setup')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(400)
      expect(res.body.message).toContain('already enabled')
    }, 30000)
  })

  describe('POST /api/auth/2fa/enable', () => {
    it('requires authentication', async () => {
      const res = await request(app).post('/api/auth/2fa/enable').send({ code: '123456' })
      expect(res.status).toBe(401)
    })

    it('enables 2FA with a valid code and returns backup codes', async () => {
      const { email, res: reg } = await registerUser('enable')
      const token = reg.body.data.token

      await request(app).post('/api/auth/2fa/setup').set('Authorization', `Bearer ${token}`)

      const user = await prisma.user.findFirst({ where: { email } })
      const code = await generate({ secret: decryptSecret(user.twoFactorSecret) })

      const res = await request(app)
        .post('/api/auth/2fa/enable')
        .set('Authorization', `Bearer ${token}`)
        .send({ code })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.backupCodes).toHaveLength(10)
      expect(res.body.data.backupCodes[0]).toBeTypeOf('string')

      // Verify DB state
      const updated = await prisma.user.findFirst({ where: { email } })
      expect(updated.twoFactorEnabled).toBe(true)
      expect(updated.twoFactorBackupCodes).toHaveLength(10)
    }, 30000)

    it('rejects enable with invalid code', async () => {
      const { res: reg } = await registerUser('enable-invalid')
      const token = reg.body.data.token

      await request(app).post('/api/auth/2fa/setup').set('Authorization', `Bearer ${token}`)

      const res = await request(app)
        .post('/api/auth/2fa/enable')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '000000' })

      expect(res.status).toBe(400)
      expect(res.body.message).toContain('Invalid verification code')
    })

    it('rejects enable without setup first', async () => {
      const { res: reg } = await registerUser('enable-no-setup')
      const token = reg.body.data.token

      const res = await request(app)
        .post('/api/auth/2fa/enable')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '123456' })

      expect(res.status).toBe(400)
      expect(res.body.message).toContain('set up 2FA first')
    })
  })

  describe('POST /api/auth/2fa/disable', () => {
    it('requires authentication', async () => {
      const res = await request(app).post('/api/auth/2fa/disable').send({ password: 'test' })
      expect(res.status).toBe(401)
    })

    it('disables 2FA with correct password', async () => {
      const { email, res: reg } = await registerUser('disable')
      const token = reg.body.data.token

      // Setup + enable
      await request(app).post('/api/auth/2fa/setup').set('Authorization', `Bearer ${token}`)
      const user = await prisma.user.findFirst({ where: { email } })
      const code = await generate({ secret: decryptSecret(user.twoFactorSecret) })
      await request(app)
        .post('/api/auth/2fa/enable')
        .set('Authorization', `Bearer ${token}`)
        .send({ code })

      // Disable
      const res = await request(app)
        .post('/api/auth/2fa/disable')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: VALID_PASSWORD })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      const updated = await prisma.user.findFirst({ where: { email } })
      expect(updated.twoFactorEnabled).toBe(false)
      expect(updated.twoFactorSecret).toBeNull()
      expect(updated.twoFactorBackupCodes).toHaveLength(0)
    }, 30000)

    it('rejects disable with wrong password', async () => {
      const { email, res: reg } = await registerUser('disable-wrong')
      const token = reg.body.data.token

      await request(app).post('/api/auth/2fa/setup').set('Authorization', `Bearer ${token}`)
      const user = await prisma.user.findFirst({ where: { email } })
      const code = await generate({ secret: decryptSecret(user.twoFactorSecret) })
      await request(app)
        .post('/api/auth/2fa/enable')
        .set('Authorization', `Bearer ${token}`)
        .send({ code })

      const res = await request(app)
        .post('/api/auth/2fa/disable')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: 'WrongPassword123' })

      expect(res.status).toBe(401)
      expect(res.body.message).toContain('Password is incorrect')
    }, 30000)

    it('rejects disable when 2FA is not enabled', async () => {
      const { res: reg } = await registerUser('disable-not-enabled')
      const token = reg.body.data.token

      const res = await request(app)
        .post('/api/auth/2fa/disable')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: VALID_PASSWORD })

      expect(res.status).toBe(400)
      expect(res.body.message).toContain('not enabled')
    })
  })

  describe('Login flow with 2FA', () => {
    it('returns twoFactorRequired instead of tokens when 2FA is enabled', async () => {
      const { email, res: reg } = await registerUser('login-2fa')
      const token = reg.body.data.token

      await request(app).post('/api/auth/2fa/setup').set('Authorization', `Bearer ${token}`)
      const user = await prisma.user.findFirst({ where: { email } })
      const code = await generate({ secret: decryptSecret(user.twoFactorSecret) })
      await request(app)
        .post('/api/auth/2fa/enable')
        .set('Authorization', `Bearer ${token}`)
        .send({ code })

      const res = await login(email)

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.twoFactorRequired).toBe(true)
      expect(res.body.data.challengeToken).toBeTypeOf('string')
      expect(res.body.data.token).toBeUndefined()
      expect(res.body.data.refreshToken).toBeUndefined()
    }, 30000)

    it('completes login with valid TOTP code via /api/auth/2fa/verify', async () => {
      const { email, res: reg } = await registerUser('verify-totp')
      const token = reg.body.data.token

      await request(app).post('/api/auth/2fa/setup').set('Authorization', `Bearer ${token}`)
      const user = await prisma.user.findFirst({ where: { email } })
      const code = await generate({ secret: decryptSecret(user.twoFactorSecret) })
      await request(app)
        .post('/api/auth/2fa/enable')
        .set('Authorization', `Bearer ${token}`)
        .send({ code })

      const loginRes = await login(email)
      const challengeToken = loginRes.body.data.challengeToken

      // Generate a fresh TOTP code (the one used for enable may have rotated)
      const freshCode = await generate({ secret: decryptSecret(user.twoFactorSecret) })

      const res = await request(app)
        .post('/api/auth/2fa/verify')
        .send({ challengeToken, code: freshCode })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.user).toBeDefined()
      expect(res.body.data.token).toBeTypeOf('string')
      expect(res.body.data.refreshToken).toBeTypeOf('string')
      expect(res.body.data.backupCodeUsed).toBeUndefined()
    }, 30000)

    it('completes login with a backup code and marks it as used', async () => {
      const { email, res: reg } = await registerUser('verify-backup')
      const token = reg.body.data.token

      await request(app).post('/api/auth/2fa/setup').set('Authorization', `Bearer ${token}`)
      const user = await prisma.user.findFirst({ where: { email } })
      const code = await generate({ secret: decryptSecret(user.twoFactorSecret) })
      const enableRes = await request(app)
        .post('/api/auth/2fa/enable')
        .set('Authorization', `Bearer ${token}`)
        .send({ code })

      const backupCode = enableRes.body.data.backupCodes[0]

      const loginRes = await login(email)
      const challengeToken = loginRes.body.data.challengeToken

      const res = await request(app)
        .post('/api/auth/2fa/verify')
        .send({ challengeToken, code: backupCode })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.token).toBeTypeOf('string')
      expect(res.body.data.backupCodeUsed).toBe(true)

      // Verify the backup code was consumed
      const updated = await prisma.user.findFirst({ where: { email } })
      expect(updated.twoFactorBackupCodes).toHaveLength(9)
    }, 30000)

    it('rejects verify with invalid TOTP code', async () => {
      const { email, res: reg } = await registerUser('verify-invalid')
      const token = reg.body.data.token

      await request(app).post('/api/auth/2fa/setup').set('Authorization', `Bearer ${token}`)
      const user = await prisma.user.findFirst({ where: { email } })
      const code = await generate({ secret: decryptSecret(user.twoFactorSecret) })
      await request(app)
        .post('/api/auth/2fa/enable')
        .set('Authorization', `Bearer ${token}`)
        .send({ code })

      const loginRes = await login(email)
      const challengeToken = loginRes.body.data.challengeToken

      const res = await request(app)
        .post('/api/auth/2fa/verify')
        .send({ challengeToken, code: '000000' })

      expect(res.status).toBe(401)
      expect(res.body.message).toContain('Invalid verification code')
    }, 30000)

    it('rejects verify with invalid challenge token', async () => {
      const res = await request(app)
        .post('/api/auth/2fa/verify')
        .send({ challengeToken: 'invalid-token', code: '123456' })

      expect(res.status).toBe(401)
      expect(res.body.message).toContain('Invalid or expired challenge')
    })

    it('rejects reusing an already-used challenge', async () => {
      const { email, res: reg } = await registerUser('verify-reuse')
      const token = reg.body.data.token

      await request(app).post('/api/auth/2fa/setup').set('Authorization', `Bearer ${token}`)
      const user = await prisma.user.findFirst({ where: { email } })
      const code = await generate({ secret: decryptSecret(user.twoFactorSecret) })
      await request(app)
        .post('/api/auth/2fa/enable')
        .set('Authorization', `Bearer ${token}`)
        .send({ code })

      const loginRes = await login(email)
      const challengeToken = loginRes.body.data.challengeToken

      const freshCode = await generate({ secret: decryptSecret(user.twoFactorSecret) })
      // First use — should succeed
      await request(app).post('/api/auth/2fa/verify').send({ challengeToken, code: freshCode })

      // Second use — should fail
      const freshCode2 = await generate({ secret: decryptSecret(user.twoFactorSecret) })
      const res = await request(app)
        .post('/api/auth/2fa/verify')
        .send({ challengeToken, code: freshCode2 })

      expect(res.status).toBe(401)
      expect(res.body.message).toContain('already used')
    }, 30000)

    it('rejects verify with missing challengeToken', async () => {
      const res = await request(app).post('/api/auth/2fa/verify').send({ code: '123456' })

      expect(res.status).toBe(400)
    })

    it('rejects verify with missing code', async () => {
      const res = await request(app)
        .post('/api/auth/2fa/verify')
        .send({ challengeToken: 'some-token' })

      expect(res.status).toBe(400)
    })
  })

  describe('Login without 2FA (regression)', () => {
    it('returns tokens directly when 2FA is not enabled', async () => {
      const { email, res: reg } = await registerUser('no-2fa')
      expect(reg.body.data.token).toBeTypeOf('string')
      expect(reg.body.data.twoFactorRequired).toBeUndefined()

      const res = await login(email)
      expect(res.status).toBe(200)
      expect(res.body.data.token).toBeTypeOf('string')
      expect(res.body.data.refreshToken).toBeTypeOf('string')
      expect(res.body.data.twoFactorRequired).toBeUndefined()
    })
  })
})
