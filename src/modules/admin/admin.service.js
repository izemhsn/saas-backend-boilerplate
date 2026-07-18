import { prisma } from '../../config/db.js'
import { httpError } from '../../utils/httpError.js'
import { paginationParams, paginationMeta, parseSort, buildSearch } from '../../utils/query.js'

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  emailVerified: true,
  banned: true,
  bannedAt: true,
  suspendedUntil: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
}

export const listUsers = async (query) => {
  const { page, limit, search, role, status, sort, order } = query

  const where = {}

  const searchClause = buildSearch(search, ['email', 'name'])
  if (searchClause) where.OR = searchClause

  if (role) {
    where.role = role
  }

  if (status === 'banned') {
    where.banned = true
  } else if (status === 'suspended') {
    where.suspendedUntil = { gt: new Date() }
  } else if (status === 'active') {
    where.banned = false
    where.AND = [
      { OR: [{ suspendedUntil: null }, { suspendedUntil: { lte: new Date() } }] },
    ]
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: parseSort(sort, order, ['createdAt', 'email', 'name']),
      ...paginationParams(page, limit),
    }),
    prisma.user.count({ where }),
  ])

  return {
    users,
    pagination: paginationMeta(page, limit, total),
  }
}

export const getUser = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: userSelect,
  })
  if (!user) throw httpError('User not found', 404)

  return { user }
}

export const updateUser = async (userId, data) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  })
  if (!user) throw httpError('User not found', 404)

  const updateData = {}

  if (data.name !== undefined) updateData.name = data.name
  if (data.role !== undefined) updateData.role = data.role
  if (data.banned !== undefined) {
    updateData.banned = data.banned
    updateData.bannedAt = data.banned ? new Date() : null
  }
  if (data.suspendedUntil !== undefined) {
    updateData.suspendedUntil = data.suspendedUntil ? new Date(data.suspendedUntil) : null
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: userSelect,
  })

  return { user: updated }
}

export const deleteUser = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })
  if (!user) throw httpError('User not found', 404)

  await prisma.user.delete({ where: { id: userId } })
  return { message: 'User deleted successfully' }
}
