import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'
import * as notificationService from '../src/modules/notification/notification.service.js'

const RUN_ID = Date.now()
const emailFor = (label) => `test-notif-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdUserIds = []

async function registerUser(label) {
  const email = emailFor(label)
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      name: `Test ${label}`,
      email,
      password: VALID_PASSWORD,
    })
  createdUserIds.push(res.body.data.user.id)
  return { email, userId: res.body.data.user.id, token: res.body.data.token }
}

afterAll(async () => {
  for (const userId of createdUserIds) {
    await prisma.notification.deleteMany({ where: { userId } })
    await prisma.notificationPreference.deleteMany({ where: { userId } })
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
  await prisma.$disconnect()
})

describe('GET /api/notifications', () => {
  it('returns empty list for new user', async () => {
    const { token } = await registerUser('list-empty')

    const res = await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.notifications).toEqual([])
    expect(res.body.data.unreadCount).toBe(0)
  })

  it('returns notifications with unread count', async () => {
    const { token, userId } = await registerUser('list-populated')

    await notificationService.createNotification(userId, {
      type: 'SYSTEM',
      title: 'Welcome',
      message: 'Welcome to the platform',
    })
    await notificationService.createNotification(userId, {
      type: 'TEAM',
      title: 'New member',
      message: 'A new member joined your org',
    })

    const res = await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.notifications).toHaveLength(2)
    expect(res.body.data.unreadCount).toBe(2)
  })

  it('filters by type', async () => {
    const { token, userId } = await registerUser('list-filter')

    await notificationService.createNotification(userId, {
      type: 'SYSTEM',
      title: 'System msg',
      message: 'System',
    })
    await notificationService.createNotification(userId, {
      type: 'BILLING',
      title: 'Billing msg',
      message: 'Billing',
    })

    const res = await request(app)
      .get('/api/notifications?type=BILLING')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.notifications).toHaveLength(1)
    expect(res.body.data.notifications[0].type).toBe('BILLING')
  })

  it('filters unread only', async () => {
    const { token, userId } = await registerUser('list-unread')

    await notificationService.createNotification(userId, {
      type: 'SYSTEM',
      title: 'Unread',
      message: 'Unread',
    })
    const notif2 = await notificationService.createNotification(userId, {
      type: 'SYSTEM',
      title: 'Will be read',
      message: 'Read',
    })

    await notificationService.markAsRead(userId, notif2.id)

    const res = await request(app)
      .get('/api/notifications?unreadOnly=true')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.notifications).toHaveLength(1)
    expect(res.body.data.notifications[0].title).toBe('Unread')
  })

  it('rejects without auth', async () => {
    const res = await request(app).get('/api/notifications')
    expect(res.status).toBe(401)
  })
})

describe('PATCH /api/notifications/:notificationId/read', () => {
  it('marks a notification as read', async () => {
    const { token, userId } = await registerUser('mark-read')

    const notif = await notificationService.createNotification(userId, {
      type: 'SYSTEM',
      title: 'Test',
      message: 'Mark me',
    })

    const res = await request(app)
      .patch(`/api/notifications/${notif.id}/read`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.message).toMatch(/marked as read/)

    // Verify in DB
    const dbNotif = await prisma.notification.findUnique({
      where: { id: notif.id },
      select: { readAt: true },
    })
    expect(dbNotif.readAt).not.toBeNull()
  })

  it('returns 404 for non-existent notification', async () => {
    const { token } = await registerUser('mark-read-404')

    const res = await request(app)
      .patch('/api/notifications/nonexistent-id/read')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  it('does not mark another user notification as read', async () => {
    const user1 = await registerUser('mark-read-cross1')
    const user2 = await registerUser('mark-read-cross2')

    const notif = await notificationService.createNotification(user1.userId, {
      type: 'SYSTEM',
      title: 'User1 notif',
      message: 'Private',
    })

    const res = await request(app)
      .patch(`/api/notifications/${notif.id}/read`)
      .set('Authorization', `Bearer ${user2.token}`)

    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/notifications/read-all', () => {
  it('marks all notifications as read', async () => {
    const { token, userId } = await registerUser('mark-all')

    await notificationService.createNotification(userId, {
      type: 'SYSTEM',
      title: 'A',
      message: 'A',
    })
    await notificationService.createNotification(userId, { type: 'TEAM', title: 'B', message: 'B' })
    await notificationService.createNotification(userId, {
      type: 'SECURITY',
      title: 'C',
      message: 'C',
    })

    const res = await request(app)
      .patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.message).toMatch(/3 notification/)

    // Verify
    const unread = await prisma.notification.count({
      where: { userId, readAt: null },
    })
    expect(unread).toBe(0)
  })
})

describe('DELETE /api/notifications/:notificationId', () => {
  it('deletes a notification', async () => {
    const { token, userId } = await registerUser('delete')

    const notif = await notificationService.createNotification(userId, {
      type: 'SYSTEM',
      title: 'Delete me',
      message: 'Bye',
    })

    const res = await request(app)
      .delete(`/api/notifications/${notif.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.message).toMatch(/deleted/)

    const dbNotif = await prisma.notification.findUnique({ where: { id: notif.id } })
    expect(dbNotif).toBeNull()
  })

  it('returns 404 for non-existent notification', async () => {
    const { token } = await registerUser('delete-404')

    const res = await request(app)
      .delete('/api/notifications/nonexistent-id')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})

describe('GET /api/notifications/preferences', () => {
  it('returns default preferences for new user', async () => {
    const { token } = await registerUser('prefs-get')

    const res = await request(app)
      .get('/api/notifications/preferences')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.preferences.emailEnabled).toBe(true)
    expect(res.body.data.preferences.pushEnabled).toBe(true)
    expect(res.body.data.preferences.inAppEnabled).toBe(true)
    expect(res.body.data.preferences.mutedTypes).toEqual([])
  })
})

describe('PATCH /api/notifications/preferences', () => {
  it('updates notification preferences', async () => {
    const { token } = await registerUser('prefs-update')

    const res = await request(app)
      .patch('/api/notifications/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({
        emailEnabled: false,
        mutedTypes: ['BILLING'],
      })

    expect(res.status).toBe(200)
    expect(res.body.data.preferences.emailEnabled).toBe(false)
    expect(res.body.data.preferences.pushEnabled).toBe(true)
    expect(res.body.data.preferences.mutedTypes).toEqual(['BILLING'])
  })

  it('rejects empty body', async () => {
    const { token } = await registerUser('prefs-empty')

    const res = await request(app)
      .patch('/api/notifications/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(400)
  })
})

describe('Notification preferences enforcement', () => {
  it('does not create in-app notification when inAppEnabled is false', async () => {
    const { userId } = await registerUser('prefs-block')

    await notificationService.updatePreferences(userId, { inAppEnabled: false })

    const notif = await notificationService.createNotification(userId, {
      type: 'SYSTEM',
      title: 'Should not exist',
      message: 'Blocked',
    })

    expect(notif).toBeNull()

    const count = await prisma.notification.count({ where: { userId } })
    expect(count).toBe(0)
  })

  it('does not create notification for muted type', async () => {
    const { userId } = await registerUser('prefs-muted')

    await notificationService.updatePreferences(userId, { mutedTypes: ['TEAM'] })

    const notif = await notificationService.createNotification(userId, {
      type: 'TEAM',
      title: 'Muted',
      message: 'Should not exist',
    })

    expect(notif).toBeNull()

    const allowedNotif = await notificationService.createNotification(userId, {
      type: 'SYSTEM',
      title: 'Not muted',
      message: 'Should exist',
    })

    expect(allowedNotif).not.toBeNull()
  })
})
