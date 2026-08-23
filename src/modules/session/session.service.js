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
  if (!session) throw httpError('errors.sessionNotFound', 404)
  if (session.revoked) throw httpError('errors.sessionAlreadyRevoked', 400)

  const revoked = await prisma.refreshToken.update({
    where: { id: sessionId },
    data: { revoked: true },
    select: sessionSelect,
  })

  return { session: revoked }
}

export const revokeAllSessions = async (userId) => {
  // Revoking a refresh token alone doesn't touch any access token already
  // issued under it — those stay valid (per `authenticate`'s tokenVersion
  // check) for up to JWT_EXPIRES_IN after "revoke all" is called, which
  // defeats the point of an emergency kill-switch. Bump tokenVersion in the
  // same transaction so every outstanding access token is invalidated too.
  const [result] = await prisma.$transaction([
    prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    }),
  ])

  return { revokedCount: result.count }
}
