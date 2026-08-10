import { randomBytes, createHash } from 'crypto'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client.js'
import { prisma } from '../../config/db.js'
import { hashPassword, comparePassword, dummyCompare } from '../../utils/hash.js'
import { signToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt.js'
import { httpError } from '../../utils/httpError.js'
import { queueVerificationEmail, queuePasswordResetEmail } from '../jobs/email.producer.js'
import {
  getGoogleClient,
  isGoogleConfigured,
  getGoogleAuthUrl as buildGoogleAuthUrl,
} from '../../config/google.js'
import { createChallenge } from './twofa.service.js'

const hashToken = (token) => createHash('sha256').update(token).digest('hex')

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days — must match JWT_REFRESH_EXPIRES_IN
const MAX_FAILED_ATTEMPTS = 5
const LOCK_DURATION_MS = 15 * 60 * 1000 // 15 minutes

const normalizeEmail = (email) => email.trim().toLowerCase()

// Only select safe fields — password hash never leaves the DB
const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
}

// Create a refresh token record in the DB and return the raw token
const createRefreshTokenRecord = async (userId, { userAgent, ipAddress } = {}) => {
  const refreshToken = signRefreshToken({ sub: userId })
  await prisma.refreshToken.create({
    data: {
      token: hashToken(refreshToken),
      userId,
      userAgent: userAgent ?? null,
      ipAddress: ipAddress ?? null,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  })
  return refreshToken
}

// Revoke all non-revoked refresh tokens for a user
const revokeAllRefreshTokens = async (userId) => {
  await prisma.refreshToken.updateMany({
    where: { userId, revoked: false },
    data: { revoked: true },
  })
}

export const register = async (
  { name, email, password },
  { userAgent, ipAddress, locale } = {},
) => {
  const normalizedEmail = normalizeEmail(email)
  const existing = await prisma.user.findFirst({
    where: { email: normalizedEmail, deletedAt: null },
    select: { id: true },
  })
  if (existing) throw httpError('errors.emailAlreadyRegistered', 409)

  const emailVerificationToken = randomBytes(32).toString('hex')

  const { tokenVersion, ...user } = await prisma.user.create({
    data: {
      name: name.trim(),
      email: normalizedEmail,
      password: await hashPassword(password),
      emailVerificationToken: hashToken(emailVerificationToken),
      emailVerificationExpires: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
    },
    select: { ...userSelect, tokenVersion: true },
  })

  const refreshToken = await createRefreshTokenRecord(user.id, { userAgent, ipAddress })

  await queueVerificationEmail({
    to: normalizedEmail,
    token: emailVerificationToken,
    name: name.trim(),
    locale,
  })

  return {
    user,
    token: signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion,
    }),
    refreshToken,
    ...(process.env.NODE_ENV !== 'production' && { emailVerificationToken }),
  }
}

export const login = async ({ email, password }, { userAgent, ipAddress } = {}) => {
  const user = await prisma.user.findFirst({
    where: { email: normalizeEmail(email), deletedAt: null },
    select: {
      id: true,
      email: true,
      password: true,
      role: true,
      tokenVersion: true,
      failedLoginAttempts: true,
      lockedUntil: true,
      banned: true,
      suspendedUntil: true,
      twoFactorEnabled: true,
    },
  })

  // Check if account is locked (before password verification)
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    throw httpError('errors.accountLocked', 423)
  }

  // Reset lock if it has expired
  if (user?.lockedUntil && user.lockedUntil <= new Date()) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    })
    user.failedLoginAttempts = 0
    user.lockedUntil = null
  }

  // If the user has no password (OAuth-only account), reject with a helpful message
  if (user && !user.password) {
    await dummyCompare()
    throw httpError('errors.accountCreatedWithGoogle', 400)
  }

  // Always run a bcrypt compare (dummy hash if the user is missing) so response
  // timing doesn't reveal whether the email exists.
  const valid = user
    ? await comparePassword(password, user.password)
    : (await dummyCompare(), false)

  if (!valid) {
    if (user) {
      const failedAttempts = user.failedLoginAttempts + 1
      const updateData = { failedLoginAttempts: failedAttempts }
      if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
        updateData.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS)
      }
      await prisma.user.update({
        where: { id: user.id },
        data: updateData,
      })
    }
    throw httpError('errors.invalidCredentials', 401)
  }

  if (user.banned) {
    throw httpError('errors.accountBanned', 403)
  }

  if (user.suspendedUntil && user.suspendedUntil > new Date()) {
    throw httpError('errors.accountSuspended', 403, { until: user.suspendedUntil.toISOString() })
  }

  // If 2FA is enabled, return a challenge token instead of issuing JWTs.
  // The client must POST /api/auth/2fa/verify with the challenge + TOTP/backup code.
  if (user.twoFactorEnabled) {
    const challengeToken = await createChallenge(user.id)
    return { twoFactorRequired: true, challengeToken }
  }

  const refreshToken = await createRefreshTokenRecord(user.id, { userAgent, ipAddress })
  const safeUser = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    select: userSelect,
  })

  return {
    user: safeUser,
    token: signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    }),
    refreshToken,
  }
}

export const refresh = async ({ refreshToken }, { userAgent, ipAddress } = {}) => {
  try {
    verifyRefreshToken(refreshToken)
  } catch {
    throw httpError('errors.invalidOrExpiredRefreshToken', 401)
  }

  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: hashToken(refreshToken) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          tokenVersion: true,
          banned: true,
          suspendedUntil: true,
        },
      },
    },
  })

  // Reuse detection: if the token exists but is revoked, someone is trying to reuse
  // an already-rotated token. Revoke ALL tokens for this user as a compromise signal.
  if (storedToken?.revoked) {
    await prisma.refreshToken.updateMany({
      where: { userId: storedToken.userId },
      data: { revoked: true },
    })
    throw httpError('errors.invalidRefreshToken', 401)
  }

  if (!storedToken) throw httpError('errors.invalidRefreshToken', 401)

  const user = storedToken.user

  if (user.banned) {
    throw httpError('errors.accountBanned', 403)
  }

  if (user.suspendedUntil && user.suspendedUntil > new Date()) {
    throw httpError('errors.accountSuspended', 403, { until: user.suspendedUntil.toISOString() })
  }

  // Rotate: revoke the old token and issue a new one
  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: { revoked: true },
  })

  const newRefreshToken = await createRefreshTokenRecord(user.id, { userAgent, ipAddress })

  return {
    token: signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    }),
    refreshToken: newRefreshToken,
  }
}

export const verifyEmail = async ({ token }) => {
  const user = await prisma.user.findUnique({
    where: { emailVerificationToken: hashToken(token) },
    select: { id: true, emailVerified: true, pendingEmail: true, emailVerificationExpires: true },
  })
  if (!user) throw httpError('errors.invalidOrExpiredVerificationToken', 400)
  if (user.emailVerified && !user.pendingEmail) {
    return { messageKey: 'messages.emailAlreadyVerified' }
  }
  if (user.emailVerificationExpires && user.emailVerificationExpires < new Date()) {
    // Clear the stale token so it can't be probed again
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationToken: null, emailVerificationExpires: null },
    })
    throw httpError('errors.verificationTokenExpired', 400)
  }

  const updateData = {
    emailVerified: true,
    emailVerificationToken: null,
    emailVerificationExpires: null,
  }

  if (user.pendingEmail) {
    updateData.email = user.pendingEmail
    updateData.pendingEmail = null
  }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    })
  } catch (err) {
    if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
      throw httpError('errors.emailAlreadyInUseChangeEmail', 409)
    }
    throw err
  }
  return { messageKey: 'messages.emailVerifiedSuccessfully' }
}

export const resendVerification = async ({ email }, { locale } = {}) => {
  const normalizedEmail = normalizeEmail(email)
  const user = await prisma.user.findFirst({
    where: { email: normalizedEmail, deletedAt: null },
    select: { id: true, name: true, emailVerified: true },
  })

  // Don't reveal whether the account exists or is already verified
  if (!user || user.emailVerified) {
    return { messageKey: 'messages.verificationEmailSent' }
  }

  const emailVerificationToken = randomBytes(32).toString('hex')
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerificationToken: hashToken(emailVerificationToken),
      emailVerificationExpires: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
    },
  })

  await queueVerificationEmail({
    to: normalizedEmail,
    token: emailVerificationToken,
    name: user.name,
    locale,
  })

  return {
    messageKey: 'messages.verificationEmailSent',
    ...(process.env.NODE_ENV !== 'production' && { emailVerificationToken }),
  }
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

export const forgotPassword = async ({ email }, { locale } = {}) => {
  const normalizedEmail = normalizeEmail(email)
  const user = await prisma.user.findFirst({
    where: { email: normalizedEmail, deletedAt: null },
    select: { id: true, name: true },
  })

  // Don't reveal whether the email exists
  if (!user) {
    return { messageKey: 'messages.passwordResetTokenSent' }
  }

  const resetToken = randomBytes(32).toString('hex')
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: hashToken(resetToken),
      passwordResetExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  })

  await queuePasswordResetEmail({ to: normalizedEmail, token: resetToken, name: user.name, locale })

  return {
    messageKey: 'messages.passwordResetTokenSent',
    ...(process.env.NODE_ENV !== 'production' && { resetToken }),
  }
}

export const resetPassword = async ({ token, newPassword }) => {
  const user = await prisma.user.findUnique({
    where: { passwordResetToken: hashToken(token) },
    select: { id: true, passwordResetExpires: true },
  })
  if (!user || !user.passwordResetExpires || user.passwordResetExpires < new Date()) {
    // Clear the stale token if the account was found but the token has expired
    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordResetToken: null, passwordResetExpires: null },
      })
    }
    throw httpError('errors.invalidOrExpiredResetToken', 400)
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: await hashPassword(newPassword),
      passwordResetToken: null,
      passwordResetExpires: null,
      tokenVersion: { increment: 1 },
    },
  })
  await revokeAllRefreshTokens(user.id)

  return { messageKey: 'messages.passwordResetSuccess' }
}

export const changePassword = async (userId, { currentPassword, newPassword }) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, password: true },
  })
  if (!user) throw httpError('errors.userNotFound', 404)

  if (!user.password) throw httpError('errors.accountNoPassword', 400)

  const valid = await comparePassword(currentPassword, user.password)
  if (!valid) throw httpError('errors.currentPasswordIncorrect', 401)

  const samePassword = await comparePassword(newPassword, user.password)
  if (samePassword) throw httpError('errors.newPasswordMustDiffer', 400)

  await prisma.user.update({
    where: { id: userId },
    data: { password: await hashPassword(newPassword), tokenVersion: { increment: 1 } },
  })
  await revokeAllRefreshTokens(userId)
  return { messageKey: 'messages.passwordChangedSuccess' }
}

export const changeEmail = async (userId, { newEmail, password }, { locale } = {}) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, password: true },
  })
  if (!user) throw httpError('errors.userNotFound', 404)

  if (!user.password) throw httpError('errors.accountNoPassword', 400)

  const valid = await comparePassword(password, user.password)
  if (!valid) throw httpError('errors.passwordIncorrect', 401)

  const normalizedNewEmail = normalizeEmail(newEmail)
  const taken = await prisma.user.findFirst({
    where: { email: normalizedNewEmail, deletedAt: null },
    select: { id: true },
  })
  if (taken) throw httpError('errors.emailAlreadyInUse', 409)

  // Check if pendingEmail is already claimed by another user
  const pendingTaken = await prisma.user.findFirst({
    where: { pendingEmail: normalizedNewEmail, NOT: { id: userId } },
    select: { id: true },
  })
  if (pendingTaken) throw httpError('errors.emailAlreadyInUse', 409)

  const emailVerificationToken = randomBytes(32).toString('hex')
  await prisma.user.update({
    where: { id: userId },
    data: {
      pendingEmail: normalizedNewEmail,
      emailVerificationToken: hashToken(emailVerificationToken),
      emailVerificationExpires: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
    },
    select: userSelect,
  })
  await queueVerificationEmail({
    to: normalizedNewEmail,
    token: emailVerificationToken,
    name: user.name,
    locale,
  })
  return {
    messageKey: 'messages.verificationEmailSentToNewAddress',
    ...(process.env.NODE_ENV !== 'production' && { emailVerificationToken }),
  }
}

export const logout = async (userId, refreshToken) => {
  if (refreshToken) {
    // Revoke just the provided refresh token (per-session logout)
    await prisma.refreshToken.updateMany({
      where: { token: hashToken(refreshToken), userId },
      data: { revoked: true },
    })
  } else {
    // Revoke all refresh tokens for this user (logout everywhere)
    await revokeAllRefreshTokens(userId)
  }
  return { messageKey: 'messages.loggedOutSuccessfully' }
}

export const getGoogleAuthUrl = () => {
  if (!isGoogleConfigured()) throw httpError('errors.googleNotConfigured', 503)
  const url = buildGoogleAuthUrl()
  if (!url) throw httpError('errors.googleNotConfigured', 503)
  return { url }
}

export const googleLogin = async ({ code }, { userAgent, ipAddress } = {}) => {
  if (!isGoogleConfigured()) throw httpError('errors.googleNotConfigured', 503)
  const client = getGoogleClient()

  let ticket
  try {
    const { tokens } = await client.getToken(code)
    ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    })
  } catch {
    throw httpError('errors.googleAuthFailed', 401)
  }

  const payload = ticket.getPayload()
  if (!payload?.sub || !payload?.email) {
    throw httpError('errors.googleNoProfileInfo', 400)
  }

  const googleId = payload.sub
  const normalizedEmail = normalizeEmail(payload.email)
  const name = payload.name ?? null

  // 1. User already linked to this Google account — log them in
  let user = await prisma.user.findFirst({
    where: { googleId, deletedAt: null },
    select: { ...userSelect, tokenVersion: true, banned: true, suspendedUntil: true },
  })

  // 2. No googleId match, but email exists — link the Google account
  if (!user) {
    user = await prisma.user.findFirst({
      where: { email: normalizedEmail, deletedAt: null },
      select: {
        ...userSelect,
        tokenVersion: true,
        banned: true,
        suspendedUntil: true,
        googleId: true,
      },
    })
    if (user) {
      if (user.googleId && user.googleId !== googleId) {
        throw httpError('errors.emailLinkedToAnotherGoogle', 409)
      }
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleId, emailVerified: true },
        select: { ...userSelect, tokenVersion: true, banned: true, suspendedUntil: true },
      })
    }
  }

  // 3. No existing user — create a new one with Google
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name,
        googleId,
        emailVerified: true,
      },
      select: { ...userSelect, tokenVersion: true, banned: true, suspendedUntil: true },
    })
  }

  if (user.banned) {
    throw httpError('errors.accountBanned', 403)
  }

  if (user.suspendedUntil && user.suspendedUntil > new Date()) {
    throw httpError('errors.accountSuspended', 403, { until: user.suspendedUntil.toISOString() })
  }

  const { tokenVersion, ...safeUser } = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
    select: { ...userSelect, tokenVersion: true },
  })

  const refreshToken = await createRefreshTokenRecord(user.id, { userAgent, ipAddress })

  return {
    user: safeUser,
    token: signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion,
    }),
    refreshToken,
  }
}

export const getMe = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: userSelect,
  })
  if (!user) throw httpError('errors.userNotFound', 404)

  return user
}
