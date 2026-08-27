import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import { generate } from 'otplib'
import { createHash } from 'crypto'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'
import { decryptSecret } from '../src/utils/secretCrypto.js'

// T4 — regression tests for two deliberate race-hardening mechanisms that no
// other test exercises concurrently: the login-lockout atomic increment
// (auth.service.js) and the 2FA challenge single-claim guard (twofa.service.js).
// Both send genuinely parallel requests (Promise.all) rather than sequential
// ones, since a read-modify-write regression only shows up under real overlap.

const RUN_ID = Date.now()
const emailFor = (label) => `test-concurrency-${label}-${RUN_ID}@example.com`
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

const login = async (email, password = VALID_PASSWORD) =>
  request(app).post('/api/auth/login').send({ email, password })

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

describe('Concurrency races', () => {
  // MAX_FAILED_ATTEMPTS in auth.service.js
  const MAX_FAILED_ATTEMPTS = 5

  it('increments failedLoginAttempts atomically under concurrent failed logins', async () => {
    const { email } = await registerUser('lockout-race')

    // Fire MAX_FAILED_ATTEMPTS wrong-password logins at once. auth.service.js
    // uses `data: { failedLoginAttempts: { increment: 1 } }`, a single atomic
    // UPDATE per request — if this ever regressed to a read-then-write
    // (read count, compute count+1, write it), concurrent requests could
    // read the same starting value and clobber each other's increment,
    // landing on a final count lower than the number of failed attempts.
    const attempts = await Promise.all(
      Array.from({ length: MAX_FAILED_ATTEMPTS }, () => login(email, 'WrongPass1')),
    )
    for (const res of attempts) {
      expect(res.status).toBe(401)
    }

    const user = await prisma.user.findFirst({ where: { email } })
    expect(user.failedLoginAttempts).toBe(MAX_FAILED_ATTEMPTS)
    expect(user.lockedUntil).not.toBeNull()
    expect(user.lockedUntil.getTime()).toBeGreaterThan(Date.now())

    // The account is now locked even for the correct password. M3 collapsed
    // the distinct 423 "locked" response into the generic 401 (it was an
    // account-existence oracle); the lockout itself is asserted above via
    // failedLoginAttempts/lockedUntil.
    const lockedRes = await login(email, VALID_PASSWORD)
    expect(lockedRes.status).toBe(401)
  }, 15000)

  it('claims a 2FA challenge exactly once under concurrent verify requests', async () => {
    const { email, res: reg } = await registerUser('challenge-race')
    const token = reg.body.data.token

    await request(app).post('/api/auth/2fa/setup').set('Authorization', `Bearer ${token}`)
    const user = await prisma.user.findFirst({ where: { email } })
    const setupCode = await generate({ secret: decryptSecret(user.twoFactorSecret) })
    await request(app)
      .post('/api/auth/2fa/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: setupCode })

    // Open a fresh login challenge and race concurrent verify requests
    // against it with the same valid code. twofa.service.js claims the
    // challenge via `updateMany({ where: { id, used: false } })` and checks
    // `count === 0` — if that ever regressed to a check-then-set (read
    // `used`, then write it), two concurrent requests could both read
    // `used: false` and both succeed, issuing two token pairs for one code.
    const loginRes = await login(email)
    expect(loginRes.body.data.twoFactorRequired).toBe(true)
    const { challengeToken } = loginRes.body.data
    const enabledUser = await prisma.user.findFirst({ where: { email } })
    const code = await generate({ secret: decryptSecret(enabledUser.twoFactorSecret) })

    const verifications = await Promise.all(
      Array.from({ length: 3 }, () =>
        request(app).post('/api/auth/2fa/verify').send({ challengeToken, code }),
      ),
    )

    const succeeded = verifications.filter((res) => res.status === 200)
    const rejected = verifications.filter((res) => res.status === 401)
    expect(succeeded).toHaveLength(1)
    expect(rejected).toHaveLength(2)
    expect(succeeded[0].body.data.token).toBeTypeOf('string')

    const challenge = await prisma.twoFactorChallenge.findUnique({
      where: { token: createHash('sha256').update(challengeToken).digest('hex') },
    })
    // Challenge is deleted or consumed by expiry cleanup elsewhere; if still
    // present it must be marked used exactly once, never left re-claimable.
    if (challenge) expect(challenge.used).toBe(true)
  }, 15000)
})
