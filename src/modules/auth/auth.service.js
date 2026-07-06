import { randomBytes, createHash } from 'crypto'
import { prisma } from '../../config/db.js'
import { hashPassword, comparePassword } from '../../utils/hash.js'
import { signToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt.js'
import { httpError } from '../../utils/httpError.js'
import { sendVerificationEmail, sendPasswordResetEmail } from '../shared/email.service.js'

const hashToken = (token) => createHash('sha256').update(token).digest('hex')

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

const normalizeEmail = (email) => email.trim().toLowerCase()

// Only select safe fields — password hash never leaves the DB
const userSelect = {
  id: true, name: true, email: true,
  role: true, createdAt: true,
}

export const register = async ({ name, email, password }) => {
  const normalizedEmail = normalizeEmail(email)
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } })
  if (existing) throw httpError('Email already registered', 409)

  const emailVerificationToken = randomBytes(32).toString('hex')

  const user = await prisma.user.create({
    data: {
      name: name.trim(), email: normalizedEmail, password: await hashPassword(password),
      emailVerificationToken: hashToken(emailVerificationToken),
      emailVerificationExpires: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
    },
    select: userSelect,
  })

  const refreshToken = signRefreshToken({ sub: user.id })
  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken: hashToken(refreshToken) },
  })

  await sendVerificationEmail({ to: normalizedEmail, token: emailVerificationToken, name: name.trim() })

  return {
    user,
    token: signToken({ id: user.id, email: user.email, role: user.role }),
    refreshToken,
    ...(process.env.NODE_ENV !== 'production' && { emailVerificationToken }),
  }
}

export const login = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } })

  // Check both at once — don't reveal whether the email exists
  const valid = user && (await comparePassword(password, user.password))
  if (!valid) throw httpError('Invalid credentials', 401)

  const refreshToken = signRefreshToken({ sub: user.id })
  const safeUser = await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken: hashToken(refreshToken) },
    select: userSelect,
  })

  return {
    user: safeUser,
    token: signToken({ id: user.id, email: user.email, role: user.role }),
    refreshToken,
  }
}

export const refresh = async ({ refreshToken }) => {
  try {
    verifyRefreshToken(refreshToken)
  } catch {
    throw httpError('Invalid or expired refresh token', 401)
  }

  const user = await prisma.user.findUnique({
    where: { refreshToken: hashToken(refreshToken) },
  })
  if (!user) throw httpError('Invalid refresh token', 401)

  // Rotate: issue a brand-new refresh token and invalidate the old one
  const newRefreshToken = signRefreshToken({ sub: user.id })
  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken: hashToken(newRefreshToken) },
  })

  return {
    token: signToken({ id: user.id, email: user.email, role: user.role }),
    refreshToken: newRefreshToken,
  }
}

export const verifyEmail = async ({ token }) => {
  const user = await prisma.user.findUnique({ where: { emailVerificationToken: hashToken(token) } })
  if (!user) throw httpError('Invalid or expired verification token', 400)
  if (user.emailVerified && !user.pendingEmail) {
    return { message: 'Email already verified' }
  }
  if (user.emailVerificationExpires && user.emailVerificationExpires < new Date()) {
    throw httpError('Verification token has expired. Please request a new one.', 400)
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

  await prisma.user.update({
    where: { id: user.id },
    data: updateData,
  })
  return { message: 'Email verified successfully' }
}

export const resendVerification = async ({ email }) => {
  const normalizedEmail = normalizeEmail(email)
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })

  // Don't reveal whether the account exists or is already verified
  if (!user || user.emailVerified) {
    return { message: 'If that account needs verification, a new token has been issued.' }
  }

  const emailVerificationToken = randomBytes(32).toString('hex')
  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerificationToken: hashToken(emailVerificationToken),
      emailVerificationExpires: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
    },
  })

  await sendVerificationEmail({ to: normalizedEmail, token: emailVerificationToken, name: user.name })

  return {
    message: 'If that account needs verification, a new token has been issued.',
    ...(process.env.NODE_ENV !== 'production' && { emailVerificationToken }),
  }
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

export const forgotPassword = async ({ email }) => {
  const normalizedEmail = normalizeEmail(email)
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })

  // Don't reveal whether the email exists
  if (!user) {
    return { message: 'If that account exists, a password reset token has been issued.' }
  }

  const resetToken = randomBytes(32).toString('hex')
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: hashToken(resetToken),
      passwordResetExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  })

  await sendPasswordResetEmail({ to: normalizedEmail, token: resetToken, name: user.name })

  return {
    message: 'If that account exists, a password reset token has been issued.',
    ...(process.env.NODE_ENV !== 'production' && { resetToken }),
  }
}

export const resetPassword = async ({ token, newPassword }) => {
  const user = await prisma.user.findUnique({
    where: { passwordResetToken: hashToken(token) },
  })
  if (!user || !user.passwordResetExpires || user.passwordResetExpires < new Date()) {
    throw httpError('Invalid or expired reset token', 400)
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: await hashPassword(newPassword),
      passwordResetToken: null,
      passwordResetExpires: null,
      refreshToken: null,
    },
  })

  return { message: 'Password reset successfully. Please log in again.' }
}

export const changePassword = async (userId, { currentPassword, newPassword }) => {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw httpError('User not found', 404)

  const valid = await comparePassword(currentPassword, user.password)
  if (!valid) throw httpError('Current password is incorrect', 401)

  const samePassword = await comparePassword(newPassword, user.password)
  if (samePassword) throw httpError('New password must be different from the current password', 400)

  await prisma.user.update({
    where: { id: userId },
    data: { password: await hashPassword(newPassword), refreshToken: null },
  })
  return { message: 'Password changed successfully. Please log in again.' }
}

export const changeEmail = async (userId, { newEmail, password }) => {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw httpError('User not found', 404)

  const valid = await comparePassword(password, user.password)
  if (!valid) throw httpError('Password is incorrect', 401)

  const normalizedNewEmail = normalizeEmail(newEmail)
  const taken = await prisma.user.findUnique({ where: { email: normalizedNewEmail } })
  if (taken) throw httpError('Email already in use', 409)

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
  await sendVerificationEmail({ to: normalizedNewEmail, token: emailVerificationToken, name: user.name })
  return {
    message: 'Verification email sent to your new address. Your email will change after verification.',
    ...(process.env.NODE_ENV !== 'production' && { emailVerificationToken }),
  }
}

export const logout = async (userId) => {
  await prisma.user.update({
    where: { id: userId },
    data: { refreshToken: null },
  })
  return { message: 'Logged out successfully' }
}

export const getMe = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: userSelect,
  })
  if (!user) throw httpError('User not found', 404)

  return user
}