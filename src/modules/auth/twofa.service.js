import { randomBytes, createHash } from 'crypto'
import { generateSecret, verify, generateURI } from 'otplib'
import QRCode from 'qrcode'
import bcrypt from 'bcryptjs'
import { prisma } from '../../config/db.js'
import { hashPassword, comparePassword } from '../../utils/hash.js'
import { signToken } from '../../utils/jwt.js'
import { httpError } from '../../utils/httpError.js'
import { encryptSecret, decryptSecret } from '../../utils/secretCrypto.js'
import { createRefreshTokenRecord } from './auth.service.js'

const CHALLENGE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const BACKUP_CODE_COUNT = 10
// Max failed code attempts per challenge — caps TOTP brute-forcing to 5 tries
// per successful password login, independent of IP-based rate limiting.
const MAX_CHALLENGE_ATTEMPTS = 5
const ISSUER = process.env.APP_NAME || 'SaaS Boilerplate'

const hashToken = (token) => createHash('sha256').update(token).digest('hex')

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
}

export const setup = async (userId) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, email: true, twoFactorEnabled: true },
  })
  if (!user) throw httpError('errors.userNotFound', 404)
  if (user.twoFactorEnabled) throw httpError('errors.twoFactorAlreadyEnabled', 400)

  const secret = generateSecret()
  const otpauth = await generateURI({
    secret,
    accountName: user.email,
    issuer: ISSUER,
  })

  // Store the secret temporarily on the user record (not yet enabled),
  // encrypted at rest so a DB leak doesn't expose TOTP seeds
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: encryptSecret(secret) },
  })

  const qrCode = await QRCode.toDataURL(otpauth)

  return { secret, qrCode, otpauth }
}

export const enable = async (userId, { code }) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, twoFactorSecret: true, twoFactorEnabled: true },
  })
  if (!user) throw httpError('errors.userNotFound', 404)
  if (user.twoFactorEnabled) throw httpError('errors.twoFactorAlreadyEnabled', 400)
  if (!user.twoFactorSecret) throw httpError('errors.twoFactorSetupFirst', 400)

  let valid = false
  try {
    const result = await verify({ token: code, secret: decryptSecret(user.twoFactorSecret) })
    valid = result.valid
  } catch {
    // Invalid token format
  }
  if (!valid) throw httpError('errors.invalidVerificationCode', 400)

  // Generate backup codes (hashed for storage, plaintext returned once)
  const backupCodes = []
  const hashedCodes = []
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const raw = randomBytes(6).toString('hex')
    backupCodes.push(raw)
    hashedCodes.push(await hashPassword(raw))
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorEnabled: true,
      twoFactorBackupCodes: hashedCodes,
    },
  })

  return { messageKey: 'messages.twoFactorEnabled', backupCodes }
}

export const disable = async (userId, { password }) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, password: true, twoFactorEnabled: true },
  })
  if (!user) throw httpError('errors.userNotFound', 404)
  if (!user.twoFactorEnabled) throw httpError('errors.twoFactorNotEnabled', 400)

  if (!user.password) {
    throw httpError('errors.accountNoPassword', 400)
  }

  const valid = await comparePassword(password, user.password)
  if (!valid) throw httpError('errors.passwordIncorrect', 401)

  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: [],
    },
  })

  return { messageKey: 'messages.twoFactorDisabled' }
}

export const createChallenge = async (userId) => {
  const challengeToken = randomBytes(32).toString('hex')
  await prisma.twoFactorChallenge.create({
    data: {
      token: hashToken(challengeToken),
      userId,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  })
  return challengeToken
}

export const verifyChallenge = async ({ challengeToken, code }, { userAgent, ipAddress } = {}) => {
  const stored = await prisma.twoFactorChallenge.findUnique({
    where: { token: hashToken(challengeToken) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          tokenVersion: true,
          banned: true,
          suspendedUntil: true,
          deletedAt: true,
          twoFactorSecret: true,
          twoFactorBackupCodes: true,
        },
      },
    },
  })

  if (!stored) throw httpError('errors.invalidOrExpiredChallenge', 401)
  if (stored.used) throw httpError('errors.challengeAlreadyUsed', 401)
  if (stored.attempts >= MAX_CHALLENGE_ATTEMPTS) {
    throw httpError('errors.tooManyVerificationAttempts', 401)
  }
  if (stored.expiresAt < new Date()) {
    await prisma.twoFactorChallenge.delete({ where: { id: stored.id } })
    throw httpError('errors.challengeExpired', 401)
  }

  const { user } = stored

  // Soft-deleted users must not be able to complete a login challenge
  if (user.deletedAt) throw httpError('errors.invalidOrExpiredChallenge', 401)

  if (user.banned) throw httpError('errors.accountBanned', 403)
  if (user.suspendedUntil && user.suspendedUntil > new Date()) {
    throw httpError('errors.accountSuspended', 403, { until: user.suspendedUntil.toISOString() })
  }

  // Try TOTP code first, then backup codes.
  // otplib's verify throws on non-numeric tokens (e.g. backup codes), so wrap it.
  let totpValid = false
  try {
    const totpResult = await verify({ token: code, secret: decryptSecret(user.twoFactorSecret) })
    totpValid = totpResult.valid
  } catch {
    // Token format is invalid (not a 6-digit TOTP) — fall through to backup codes
  }

  // Check backup codes (matched hash is consumed after the challenge is claimed)
  let matchedBackupHash = null
  if (!totpValid) {
    for (const hashed of user.twoFactorBackupCodes) {
      if (await bcrypt.compare(code, hashed)) {
        matchedBackupHash = hashed
        break
      }
    }
  }

  if (!totpValid && !matchedBackupHash) {
    // Count the failed attempt — the challenge becomes unusable after the cap
    // so an attacker can't brute-force codes within the challenge window
    const updated = await prisma.twoFactorChallenge.update({
      where: { id: stored.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    })
    if (updated.attempts >= MAX_CHALLENGE_ATTEMPTS) {
      throw httpError('errors.tooManyVerificationAttempts', 401)
    }
    throw httpError('errors.invalidVerificationCode', 401)
  }

  // Atomically claim the challenge — the `used: false` guard ensures only one
  // of two concurrent requests can win, closing the check-then-mark race
  const claimed = await prisma.twoFactorChallenge.updateMany({
    where: { id: stored.id, used: false },
    data: { used: true },
  })
  if (claimed.count === 0) throw httpError('errors.challengeAlreadyUsed', 401)

  const backupUsed = !!matchedBackupHash
  if (matchedBackupHash) {
    // Remove the used backup code (safe: the challenge claim above guarantees
    // only one concurrent request reaches this point)
    const remaining = user.twoFactorBackupCodes.filter((h) => h !== matchedBackupHash)
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorBackupCodes: remaining },
    })
  }

  const safeUser = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    select: userSelect,
  })

  const refreshToken = await createRefreshTokenRecord(user.id, { userAgent, ipAddress })

  return {
    user: safeUser,
    token: signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    }),
    refreshToken,
    ...(backupUsed && { backupCodeUsed: true }),
  }
}
