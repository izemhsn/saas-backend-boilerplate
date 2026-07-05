import { randomBytes, createHash } from 'crypto'
import { prisma } from '../../config/db.js'
import { hashPassword, comparePassword } from '../../utils/hash.js'
import { signToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt.js'
import { httpError } from '../../utils/httpError.js'

const hashToken = (token) => createHash('sha256').update(token).digest('hex')

// Only select safe fields — password hash never leaves the DB
const userSelect = {
  id: true, name: true, email: true,
  role: true, createdAt: true,
}

export const register = async ({ name, email, password }) => {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) throw httpError('Email already registered', 409)

  const emailVerificationToken = randomBytes(32).toString('hex')

  const user = await prisma.user.create({
    data: { name, email, password: await hashPassword(password), emailVerificationToken: hashToken(emailVerificationToken) },
    select: userSelect,
  })

  const refreshToken = signRefreshToken({ sub: user.id })
  await prisma.user.update({
    where: { id: user.id },
    data: { refreshToken: hashToken(refreshToken) },
  })

  return {
    user,
    token: signToken({ id: user.id, email: user.email, role: user.role }),
    refreshToken,
    ...(process.env.NODE_ENV !== 'production' && { emailVerificationToken }),
  }
}

export const login = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email } })

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
  if (user.emailVerified) {
    return { message: 'Email already verified' }
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, emailVerificationToken: null },
  })
  return { message: 'Email verified successfully' }
}

export const resendVerification = async ({ email }) => {
  const user = await prisma.user.findUnique({ where: { email } })

  // Don't reveal whether the account exists or is already verified
  if (!user || user.emailVerified) {
    return { message: 'If that account needs verification, a new token has been issued.' }
  }

  const emailVerificationToken = randomBytes(32).toString('hex')
  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerificationToken: hashToken(emailVerificationToken) },
  })

  return {
    message: 'If that account needs verification, a new token has been issued.',
    ...(process.env.NODE_ENV !== 'production' && { emailVerificationToken }),
  }
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

export const forgotPassword = async ({ email }) => {
  const user = await prisma.user.findUnique({ where: { email } })

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

  const taken = await prisma.user.findUnique({ where: { email: newEmail } })
  if (taken) throw httpError('Email already in use', 409)

  const emailVerificationToken = randomBytes(32).toString('hex')
  const refreshToken = signRefreshToken({ sub: userId })
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      email: newEmail,
      emailVerified: false,
      emailVerificationToken: hashToken(emailVerificationToken),
      refreshToken: hashToken(refreshToken),
    },
    select: userSelect,
  })
  return {
    user: updated,
    token: signToken({ id: updated.id, email: updated.email, role: updated.role }),
    refreshToken,
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