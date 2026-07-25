import { prisma } from '../../config/db.js'
import { httpError } from '../../utils/httpError.js'
import { paginationParams, paginationMeta, parseSort, buildSearch } from '../../utils/query.js'

const notificationSelect = {
  id: true,
  type: true,
  title: true,
  message: true,
  data: true,
  readAt: true,
  createdAt: true,
}

const preferenceSelect = {
  id: true,
  emailEnabled: true,
  pushEnabled: true,
  inAppEnabled: true,
  mutedTypes: true,
  createdAt: true,
  updatedAt: true,
}

// ── Notifications ───────────────────────────────────────────────────

export const createNotification = async (userId, { type, title, message, data = {} }) => {
  const prefs = await prisma.notificationPreference.findUnique({
    where: { userId },
    select: preferenceSelect,
  })

  if (prefs?.inAppEnabled === false) return null
  if (prefs?.mutedTypes?.includes(type)) return null

  const notification = await prisma.notification.create({
    data: { userId, type, title, message, data },
    select: notificationSelect,
  })

  return notification
}

export const listNotifications = async (userId, query = {}) => {
  const { page, limit, search, sort, order, type, unreadOnly } = query

  const where = { userId }

  if (type) where.type = type
  if (unreadOnly === true || unreadOnly === 'true') where.readAt = null

  const searchClause = buildSearch(search, ['title', 'message'])
  if (searchClause) where.OR = searchClause

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      select: notificationSelect,
      orderBy: parseSort(sort, order, ['createdAt', 'type', 'readAt']),
      ...paginationParams(page ?? 1, limit ?? 20),
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ])

  return {
    notifications,
    unreadCount,
    pagination: paginationMeta(page ?? 1, limit ?? 20, total),
  }
}

export const markAsRead = async (userId, notificationId) => {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
    select: { id: true, readAt: true },
  })

  if (!notification) throw httpError('Notification not found', 404)

  if (notification.readAt) {
    return { message: 'Notification already marked as read' }
  }

  await prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: new Date() },
  })

  return { message: 'Notification marked as read' }
}

export const markAllAsRead = async (userId) => {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  })

  return { message: `${result.count} notification(s) marked as read` }
}

export const deleteNotification = async (userId, notificationId) => {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
    select: { id: true },
  })

  if (!notification) throw httpError('Notification not found', 404)

  await prisma.notification.delete({ where: { id: notificationId } })

  return { message: 'Notification deleted' }
}

// ── Preferences ─────────────────────────────────────────────────────

export const getPreferences = async (userId) => {
  let prefs = await prisma.notificationPreference.findUnique({
    where: { userId },
    select: preferenceSelect,
  })

  if (!prefs) {
    prefs = await prisma.notificationPreference.create({
      data: { userId },
      select: preferenceSelect,
    })
  }

  return { preferences: prefs }
}

export const updatePreferences = async (userId, updates) => {
  const data = {}
  if (updates.emailEnabled !== undefined) data.emailEnabled = updates.emailEnabled
  if (updates.pushEnabled !== undefined) data.pushEnabled = updates.pushEnabled
  if (updates.inAppEnabled !== undefined) data.inAppEnabled = updates.inAppEnabled
  if (updates.mutedTypes !== undefined) data.mutedTypes = updates.mutedTypes

  const prefs = await prisma.notificationPreference.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
    select: preferenceSelect,
  })

  return { preferences: prefs }
}
