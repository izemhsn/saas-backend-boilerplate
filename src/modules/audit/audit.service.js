import { prisma } from '../../config/db.js'
import { paginationParams, paginationMeta, parseSort } from '../../utils/query.js'

const auditSelect = {
  id: true,
  action: true,
  userId: true,
  targetUserId: true,
  organizationId: true,
  ipAddress: true,
  userAgent: true,
  metadata: true,
  createdAt: true,
  user: { select: { id: true, email: true, name: true } },
}

// Fire-and-forget audit log — never blocks the request, never throws
export const log = (action, { userId, targetUserId, organizationId, ipAddress, userAgent, metadata = {} } = {}) => {
  prisma.auditLog
    .create({
      data: {
        action,
        userId: userId ?? null,
        targetUserId: targetUserId ?? null,
        organizationId: organizationId ?? null,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        metadata,
      },
    })
    .catch(() => {})
}

export const listAuditLogs = async (query = {}) => {
  const { page, limit, sort, order, action, userId, targetUserId, organizationId } = query

  const where = {}

  if (action) where.action = action
  if (userId) where.userId = userId
  if (targetUserId) where.targetUserId = targetUserId
  if (organizationId) where.organizationId = organizationId

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: auditSelect,
      orderBy: parseSort(sort, order, ['createdAt', 'action']),
      ...paginationParams(page, limit),
    }),
    prisma.auditLog.count({ where }),
  ])

  return {
    logs,
    pagination: paginationMeta(page, limit, total),
  }
}

export const listUserAuditLogs = async (userId, query = {}) => {
  const { page, limit, sort, order } = query

  const where = {
    OR: [{ userId }, { targetUserId: userId }],
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: auditSelect,
      orderBy: parseSort(sort, order, ['createdAt', 'action']),
      ...paginationParams(page, limit),
    }),
    prisma.auditLog.count({ where }),
  ])

  return {
    logs,
    pagination: paginationMeta(page, limit, total),
  }
}
