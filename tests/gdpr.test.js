import { describe, it, expect, afterAll, vi } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'

const RUN_ID = Date.now()
const emailFor = (label) => `test-gdpr-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdUserIds = []
const createdOrgIds = []

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

async function createOrg(ownerId, slug) {
  const org = await prisma.organization.create({
    data: {
      name: `Test Org ${slug}`,
      slug,
      ownerId,
      members: { create: { userId: ownerId, role: 'OWNER' } },
    },
    select: { id: true },
  })
  createdOrgIds.push(org.id)
  return org
}

afterAll(async () => {
  for (const orgId of createdOrgIds) {
    await prisma.organizationFeatureFlag.deleteMany({ where: { organizationId: orgId } })
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } })
    await prisma.organizationInvitation.deleteMany({ where: { organizationId: orgId } })
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {})
  }
  for (const userId of createdUserIds) {
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.notification.deleteMany({ where: { userId } })
    await prisma.notificationPreference.deleteMany({ where: { userId } })
    await prisma.auditLog.deleteMany({ where: { userId } })
    await prisma.organizationInvitation.deleteMany({ where: { inviterId: userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
  await prisma.$disconnect()
})

describe('POST /api/auth/data-export', () => {
  it('exports all user data with password re-auth', async () => {
    const { token, userId } = await registerUser('export')

    // Create some associated data
    await createOrg(userId, `export-org-${RUN_ID}`)
    await prisma.apiKey.create({
      data: {
        name: 'Test Key',
        keyHash: 'dummy-hash-' + RUN_ID,
        keyPrefix: 'tk_test',
        userId,
        scopes: ['read'],
      },
    })
    await prisma.notification.create({
      data: {
        userId,
        type: 'SYSTEM',
        title: 'Test Notification',
        message: 'Test message',
      },
    })

    const res = await request(app)
      .post('/api/auth/data-export')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: VALID_PASSWORD })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.user.id).toBe(userId)
    expect(res.body.data.user.email).toBeDefined()
    expect(res.body.data.user.password).toBeUndefined()
    expect(res.body.data.exportedAt).toBeDefined()
    expect(Array.isArray(res.body.data.ownedOrganizations)).toBe(true)
    expect(res.body.data.ownedOrganizations.length).toBeGreaterThan(0)
    expect(Array.isArray(res.body.data.apiKeys)).toBe(true)
    expect(res.body.data.apiKeys.length).toBeGreaterThan(0)
    expect(Array.isArray(res.body.data.notifications)).toBe(true)
    expect(res.body.data.notifications.length).toBeGreaterThan(0)
    expect(Array.isArray(res.body.data.auditLogs)).toBe(true)
  })

  it('rejects without auth', async () => {
    const res = await request(app).post('/api/auth/data-export').send({ password: VALID_PASSWORD })
    expect(res.status).toBe(401)
  })

  it('returns 401 when user no longer exists (hard-deleted)', async () => {
    const { token } = await registerUser('export-404')

    // Delete the user directly so the token is still present but user doesn't exist
    const user = await prisma.user.findFirst({ where: { email: emailFor('export-404') } })
    await prisma.user.delete({ where: { id: user.id } })
    createdUserIds.splice(createdUserIds.indexOf(user.id), 1)

    const res = await request(app)
      .post('/api/auth/data-export')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: VALID_PASSWORD })

    // authenticate middleware rejects because user no longer exists
    expect(res.status).toBe(401)
  })

  it('rejects data export without password', async () => {
    const { token } = await registerUser('export-no-pw')

    const res = await request(app)
      .post('/api/auth/data-export')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(401)
  })

  it('rejects data export with wrong password', async () => {
    const { token } = await registerUser('export-wrong-pw')

    const res = await request(app)
      .post('/api/auth/data-export')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'WrongPassword123' })

    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/auth/account', () => {
  it('deletes account with correct password', async () => {
    const { token, userId, email } = await registerUser('delete')

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: VALID_PASSWORD })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.message).toMatch(/deleted/i)
    expect(res.body.data.email).toBe(email)

    // Verify user is gone
    const dbUser = await prisma.user.findUnique({ where: { id: userId } })
    expect(dbUser).toBeNull()

    // Remove from cleanup list since it's already deleted
    createdUserIds.splice(createdUserIds.indexOf(userId), 1)
  })

  it('rejects incorrect password', async () => {
    const { token } = await registerUser('delete-wrong-pw')

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'WrongPassword123' })

    expect(res.status).toBe(401)
  })

  it('rejects empty password', async () => {
    const { token } = await registerUser('delete-empty-pw')

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: '' })

    expect(res.status).toBe(400)
  })

  it('rejects without auth', async () => {
    const res = await request(app).delete('/api/auth/account').send({ password: VALID_PASSWORD })

    expect(res.status).toBe(401)
  })

  it('rejects missing password field', async () => {
    const { token } = await registerUser('delete-no-pw')

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(400)
  })

  it('prevents last admin from deleting their account', async () => {
    const email = emailFor('last-admin')
    const res = await request(app).post('/api/auth/register').send({
      name: 'Last Admin',
      email,
      password: VALID_PASSWORD,
    })
    const userId = res.body.data.user.id
    createdUserIds.push(userId)

    // Make this user an admin
    await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } })

    // A shared test DB always contains other admins (seed + parallel tests), so the
    // single-admin state can't be constructed for real — stub the count for this request.
    // (Mutating other admins' rows here would break parallel test files.)
    const countSpy = vi.spyOn(prisma.user, 'count').mockResolvedValueOnce(1)

    const delRes = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${res.body.data.token}`)
      .send({ password: VALID_PASSWORD })

    countSpy.mockRestore()

    expect(delRes.status).toBe(400)
    expect(delRes.body.message).toMatch(/last admin/i)
  })

  it('cascades deletion to related data', async () => {
    const { token, userId } = await registerUser('cascade')

    // Create related data
    await createOrg(userId, `cascade-org-${RUN_ID}`)
    await prisma.apiKey.create({
      data: {
        name: 'Cascade Key',
        keyHash: 'cascade-hash-' + RUN_ID,
        keyPrefix: 'ck_test',
        userId,
        scopes: ['read'],
      },
    })
    await prisma.notification.create({
      data: {
        userId,
        type: 'SYSTEM',
        title: 'Cascade Test',
        message: 'Will be deleted',
      },
    })

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: VALID_PASSWORD })

    expect(res.status).toBe(200)

    // Verify cascaded data is gone
    const refreshTokens = await prisma.refreshToken.findMany({ where: { userId } })
    expect(refreshTokens).toHaveLength(0)

    const apiKeys = await prisma.apiKey.findMany({ where: { userId } })
    expect(apiKeys).toHaveLength(0)

    const notifications = await prisma.notification.findMany({ where: { userId } })
    expect(notifications).toHaveLength(0)

    const memberships = await prisma.organizationMember.findMany({ where: { userId } })
    expect(memberships).toHaveLength(0)

    // Owned org should be cascade-deleted
    const org = await prisma.organization.findFirst({ where: { ownerId: userId } })
    expect(org).toBeNull()

    // Audit logs should have userId set to null (SetNull relation)
    const auditLogs = await prisma.auditLog.findMany({ where: { userId } })
    expect(auditLogs).toHaveLength(0)

    // Remove from cleanup
    createdUserIds.splice(createdUserIds.indexOf(userId), 1)
    // Org was cascade-deleted, remove from cleanup
    const orgIdx = createdOrgIds.findIndex((id) => id !== null)
    if (orgIdx >= 0) createdOrgIds.splice(orgIdx, 1)
  })
})
