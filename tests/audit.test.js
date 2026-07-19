import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'

const RUN_ID = Date.now()
const emailFor = (label) => `audit-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdEmails = []
const createdUserIds = []

const registerUser = async (label) => {
  const email = emailFor(label)
  createdEmails.push(email)
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test User', email, password: VALID_PASSWORD })
  createdUserIds.push(res.body.data.user.id)
  return { email, res }
}

const makeAdmin = async (userId) => {
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } })
}

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { OR: [{ userId: { in: createdUserIds } }, { targetUserId: { in: createdUserIds } }] },
  })
  await prisma.refreshToken.deleteMany({
    where: { user: { email: { in: createdEmails } } },
  })
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } })
  await prisma.$disconnect()
})

// Helper: wait for fire-and-forget audit logs to flush
const flushAuditLogs = async () => {
  await new Promise((resolve) => setTimeout(resolve, 100))
}

describe('GET /api/audit (admin)', () => {
  it('rejects non-admin users', async () => {
    const { res: registerRes } = await registerUser('non-admin')
    const { token } = registerRes.body.data

    const res = await request(app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })

  it('returns paginated audit logs for admin', async () => {
    const { res: registerRes } = await registerUser('admin-list')
    const userId = registerRes.body.data.user.id
    await makeAdmin(userId)
    const { token } = registerRes.body.data

    await flushAuditLogs()

    const res = await request(app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.logs).toBeDefined()
    expect(res.body.data.pagination).toBeDefined()
    // At least the USER_REGISTER log should exist
    expect(res.body.data.logs.length).toBeGreaterThanOrEqual(1)
  })

  it('filters by action', async () => {
    const { res: registerRes } = await registerUser('admin-filter')
    const userId = registerRes.body.data.user.id
    await makeAdmin(userId)
    const { token } = registerRes.body.data

    await flushAuditLogs()

    const res = await request(app)
      .get('/api/audit?action=USER_REGISTER')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    for (const log of res.body.data.logs) {
      expect(log.action).toBe('USER_REGISTER')
    }
  })

  it('filters by userId', async () => {
    const { res: registerRes } = await registerUser('admin-user-filter')
    const userId = registerRes.body.data.user.id
    await makeAdmin(userId)
    const { token } = registerRes.body.data

    await flushAuditLogs()

    const res = await request(app)
      .get(`/api/audit?userId=${userId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    for (const log of res.body.data.logs) {
      expect(log.userId).toBe(userId)
    }
  })

  it('rejects unauthenticated request', async () => {
    const res = await request(app).get('/api/audit')

    expect(res.status).toBe(401)
  })
})

describe('GET /api/audit/me (user)', () => {
  it('returns own audit history', async () => {
    const { res: registerRes } = await registerUser('me-audit')
    const userId = registerRes.body.data.user.id
    const { token } = registerRes.body.data

    await flushAuditLogs()

    const res = await request(app)
      .get('/api/audit/me')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.logs.length).toBeGreaterThanOrEqual(1)
    // All logs should be related to this user
    for (const log of res.body.data.logs) {
      expect([log.userId, log.targetUserId]).toContain(userId)
    }
  })

  it('rejects unauthenticated request', async () => {
    const res = await request(app).get('/api/audit/me')

    expect(res.status).toBe(401)
  })
})

describe('Audit log integration', () => {
  it('logs USER_REGISTER on registration', async () => {
    const { res: registerRes } = await registerUser('log-register')
    const userId = registerRes.body.data.user.id

    await flushAuditLogs()

    const log = await prisma.auditLog.findFirst({
      where: { userId, action: 'USER_REGISTER' },
    })
    expect(log).not.toBeNull()
  })

  it('logs USER_LOGIN on login', async () => {
    const { email } = await registerUser('log-login')
    const user = await prisma.user.findUnique({ where: { email } })

    await request(app).post('/api/auth/login').send({ email, password: VALID_PASSWORD })

    await flushAuditLogs()

    const log = await prisma.auditLog.findFirst({
      where: { userId: user.id, action: 'USER_LOGIN' },
    })
    expect(log).not.toBeNull()
  })

  it('logs USER_LOGOUT on logout', async () => {
    const { res: registerRes } = await registerUser('log-logout')
    const userId = registerRes.body.data.user.id
    const { token, refreshToken } = registerRes.body.data

    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .send({ refreshToken })

    await flushAuditLogs()

    const log = await prisma.auditLog.findFirst({
      where: { userId, action: 'USER_LOGOUT' },
    })
    expect(log).not.toBeNull()
  })

  it('logs ORG_CREATED on organization creation', async () => {
    const { res: registerRes } = await registerUser('log-org')
    const userId = registerRes.body.data.user.id
    const { token } = registerRes.body.data

    const createRes = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Audit Test Org', slug: `audit-org-${RUN_ID}-${userId.slice(-4)}` })

    await flushAuditLogs()

    const log = await prisma.auditLog.findFirst({
      where: { userId, action: 'ORG_CREATED' },
    })
    expect(log).not.toBeNull()
    expect(log.organizationId).toBe(createRes.body.data.organization.id)
  })

  it('logs API_KEY_CREATED on API key creation', async () => {
    const { res: registerRes } = await registerUser('log-apikey')
    const userId = registerRes.body.data.user.id
    const { token } = registerRes.body.data

    await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Audit Test Key' })

    await flushAuditLogs()

    const log = await prisma.auditLog.findFirst({
      where: { userId, action: 'API_KEY_CREATED' },
    })
    expect(log).not.toBeNull()
  })

  it('logs admin actions with targetUserId', async () => {
    const { res: targetRes } = await registerUser('log-target')
    const targetUserId = targetRes.body.data.user.id

    const { res: adminRes } = await registerUser('log-admin-actor')
    const adminUserId = adminRes.body.data.user.id
    await makeAdmin(adminUserId)
    const { token } = adminRes.body.data

    await request(app)
      .patch(`/api/admin/users/${targetUserId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ banned: true })

    await flushAuditLogs()

    const log = await prisma.auditLog.findFirst({
      where: { action: 'USER_BANNED', targetUserId },
    })
    expect(log).not.toBeNull()
    expect(log.userId).toBe(adminUserId)
  })
})
