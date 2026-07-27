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
  deletedAt: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
}

export const listUsers = async (query) => {
  const { page, limit, search, role, status, sort, order } = query

  const where = { deletedAt: null }

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
  } else if (status === 'deleted') {
    where.deletedAt = { not: null }
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
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: userSelect,
  })
  if (!user) throw httpError('User not found', 404)

  return { user }
}

export const updateUser = async (userId, data, actingAdminId) => {
  if (userId === actingAdminId) {
    if (data.banned === true) throw httpError('You cannot ban your own account', 400)
    if (data.role !== undefined && data.role !== 'ADMIN')
      throw httpError('You cannot demote your own admin account', 400)
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, role: true },
  })
  if (!user) throw httpError('User not found', 404)

  // Prevent demoting the last admin
  if (data.role !== undefined && data.role !== 'ADMIN' && user.role === 'ADMIN') {
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN', deletedAt: null } })
    if (adminCount <= 1) throw httpError('Cannot demote the last admin', 400)
  }

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

export const deleteUser = async (userId, actingAdminId) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, role: true },
  })
  if (!user) throw httpError('User not found', 404)

  // Prevent deleting the last admin — checked before the self-delete guard because
  // the only way to target the last admin via the API is a self-delete (any other
  // acting admin would mean at least two admins exist)
  if (user.role === 'ADMIN') {
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN', deletedAt: null } })
    if (adminCount <= 1) throw httpError('Cannot delete the last admin', 400)
  }

  if (userId === actingAdminId)
    throw httpError('You cannot delete your own account', 400)

  await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } })
  return { message: 'User deleted successfully' }
}

export const restoreUser = async (userId) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: { not: null } },
    select: { id: true },
  })
  if (!user) throw httpError('Deleted user not found', 404)

  await prisma.user.update({
    where: { id: userId },
    data: { deletedAt: null },
    select: userSelect,
  })

  return { message: 'User restored successfully' }
}
