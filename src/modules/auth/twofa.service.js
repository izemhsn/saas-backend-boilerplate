import { randomBytes, createHash } from 'crypto'
import { generateSecret, verify, generateURI } from 'otplib'
import QRCode from 'qrcode'
import bcrypt from 'bcryptjs'
import { prisma } from '../../config/db.js'
import { hashPassword, comparePassword } from '../../utils/hash.js'
import { signToken, signRefreshToken } from '../../utils/jwt.js'
import { httpError } from '../../utils/httpError.js'

const CHALLENGE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const BACKUP_CODE_COUNT = 10

const hashToken = (token) => createHash('sha256').update(token).digest('hex')

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
}

const createRefreshTokenRecord = async (userId, { userAgent, ipAddress } = {}) => {
  const refreshToken = signRefreshToken({ sub: userId })
  await prisma.refreshToken.create({
    data: {
      token: hashToken(refreshToken),
      userId,
      userAgent: userAgent ?? null,
      ipAddress: ipAddress ?? null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })
  return refreshToken
}

export const setup = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, twoFactorEnabled: true },
  })
  if (!user) throw httpError('errors.userNotFound', 404)
  if (user.twoFactorEnabled) throw httpError('errors.twoFactorAlreadyEnabled', 400)

  const secret = generateSecret()
  const otpauth = await generateURI({
    secret,
    accountName: user.email,
    issuer: 'SaaS Boilerplate',
  })

  // Store the secret temporarily on the user record (not yet enabled)
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: secret },
  })

  const qrCode = await QRCode.toDataURL(otpauth)

  return { secret, qrCode, otpauth }
}

export const enable = async (userId, { code }) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, twoFactorSecret: true, twoFactorEnabled: true },
  })
  if (!user) throw httpError('errors.userNotFound', 404)
  if (user.twoFactorEnabled) throw httpError('errors.twoFactorAlreadyEnabled', 400)
  if (!user.twoFactorSecret) throw httpError('errors.twoFactorSetupFirst', 400)

  let valid = false
  try {
    const result = await verify({ token: code, secret: user.twoFactorSecret })
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
  const user = await prisma.user.findUnique({
    where: { id: userId },
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
          twoFactorSecret: true,
          twoFactorBackupCodes: true,
        },
      },
    },
  })

  if (!stored) throw httpError('errors.invalidOrExpiredChallenge', 401)
  if (stored.used) throw httpError('errors.challengeAlreadyUsed', 401)
  if (stored.expiresAt < new Date()) {
    await prisma.twoFactorChallenge.delete({ where: { id: stored.id } })
    throw httpError('errors.challengeExpired', 401)
  }

  const { user } = stored

  if (user.banned) throw httpError('errors.accountBanned', 403)
  if (user.suspendedUntil && user.suspendedUntil > new Date()) {
    throw httpError('errors.accountSuspended', 403, { until: user.suspendedUntil.toISOString() })
  }

  // Try TOTP code first, then backup codes.
  // otplib's verify throws on non-numeric tokens (e.g. backup codes), so wrap it.
  let totpValid = false
  try {
    const totpResult = await verify({ token: code, secret: user.twoFactorSecret })
    totpValid = totpResult.valid
  } catch {
    // Token format is invalid (not a 6-digit TOTP) — fall through to backup codes
  }
  let backupUsed = false

  if (!totpValid) {
    // Check backup codes
    for (const hashed of user.twoFactorBackupCodes) {
      if (await bcrypt.compare(code, hashed)) {
        backupUsed = true
        // Remove the used backup code
        const remaining = user.twoFactorBackupCodes.filter((h) => h !== hashed)
        await prisma.user.update({
          where: { id: user.id },
          data: { twoFactorBackupCodes: remaining },
        })
        break
      }
    }
  }

  if (!totpValid && !backupUsed) {
    throw httpError('errors.invalidVerificationCode', 401)
  }

  // Mark challenge as used
  await prisma.twoFactorChallenge.update({
    where: { id: stored.id },
    data: { used: true },
  })

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
