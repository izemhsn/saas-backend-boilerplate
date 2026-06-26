import { prisma } from '../../config/db.js'
import { hashPassword, comparePassword } from '../../utils/hash.js'
import { signToken } from '../../utils/jwt.js'

// Only select safe fields — password hash never leaves the DB
const userSelect = {
  id: true, name: true, email: true,
  role: true, createdAt: true,
}

export const register = async ({ name, email, password }) => {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    const err = new Error('Email already registered')
    err.statusCode = 409
    throw err
  }

  const user = await prisma.user.create({
    data: { name, email, password: await hashPassword(password) },
    select: userSelect,
  })

  return {
    user,
    token: signToken({ id: user.id, email: user.email, role: user.role }),
  }
}

export const login = async ({ email, password }) => {
  const user = await prisma.user.findUnique({ where: { email } })

  // Check both at once — don't reveal whether the email exists
  const valid = user && (await comparePassword(password, user.password))
  if (!valid) {
    const err = new Error('Invalid credentials')
    err.statusCode = 401
    throw err
  }

  const { password: _, ...safeUser } = user // strip password hash
  return {
    user: safeUser,
    token: signToken({ id: user.id, email: user.email, role: user.role }),
  }
}

export const getMe = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: userSelect,
  })
  if (!user) {
    const err = new Error('User not found')
    err.statusCode = 404
    throw err
  }
  return user
}