import { prisma } from '../../config/db.js'
import { httpError } from '../../utils/httpError.js'
import { paginationParams, paginationMeta, parseSort } from '../../utils/query.js'

const sessionSelect = {
  id: true,
  userAgent: true,
  ipAddress: true,
  revoked: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
}

export const listSessions = async (userId, query = {}) => {
  const { page, limit, sort, order } = query

  const where = { userId }

  const [sessions, total] = await Promise.all([
    prisma.refreshToken.findMany({
      where,
      select: sessionSelect,
      orderBy: parseSort(sort, order, ['createdAt', 'updatedAt', 'expiresAt']),
      ...paginationParams(page, limit),
    }),
    prisma.refreshToken.count({ where }),
  ])

  return {
    sessions,
    pagination: paginationMeta(page, limit, total),
  }
}

export const revokeSession = async (userId, sessionId) => {
  const session = await prisma.refreshToken.findFirst({
    where: { id: sessionId, userId },
    select: { id: true, revoked: true },
  })
  if (!session) throw httpError('Session not found', 404)
  if (session.revoked) throw httpError('Session already revoked', 400)

  const revoked = await prisma.refreshToken.update({
    where: { id: sessionId },
    data: { revoked: true },
    select: sessionSelect,
  })

  return { session: revoked }
}

export const revokeAllSessions = async (userId) => {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revoked: false },
    data: { revoked: true },
  })

  return { revokedCount: result.count }
}
