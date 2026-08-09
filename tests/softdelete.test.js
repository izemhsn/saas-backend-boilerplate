import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'

const RUN_ID = Date.now()
const emailFor = (label) => `test-soft-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdUserIds = []
const createdOrgIds = []
let adminToken = null

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

async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: VALID_PASSWORD })
  return res.body.data.token
}

beforeAll(async () => {
  // Promote a test user to admin for admin endpoint tests
  const admin = await registerUser('admin')
  await prisma.user.update({
    where: { id: admin.userId },
    data: { role: 'ADMIN', emailVerified: true },
  })
  adminToken = await login(admin.email)
})

afterAll(async () => {
  for (const orgId of createdOrgIds) {
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } })
    await prisma.organization.deleteMany({ where: { id: orgId } })
  }
  for (const userId of createdUserIds) {
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.apiKey.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
  await prisma.$disconnect()
})

describe('Soft delete — User', () => {
  it('soft-deletes a user (sets deletedAt, row remains)', async () => {
    const user = await registerUser('sd-user')

    const res = await request(app)
      .delete(`/api/admin/users/${user.userId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.message).toMatch(/deleted/)

    // Row should still exist in DB with deletedAt set
    const dbUser = await prisma.user.findFirst({
      where: { id: user.userId, deletedAt: { not: null } },
      select: { id: true, deletedAt: true },
    })
    expect(dbUser).not.toBeNull()
    expect(dbUser.deletedAt).not.toBeNull()
  })

  it('soft-deleted user cannot authenticate', async () => {
    const user = await registerUser('sd-auth')
    const token = await login(user.email)

    // Soft-delete the user
    await request(app)
      .delete(`/api/admin/users/${user.userId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    // Try to use existing token
    const res = await request(app).get('/api/sessions').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(401)
  })

  it('soft-deleted user cannot login with password', async () => {
    const user = await registerUser('sd-login')

    await request(app)
      .delete(`/api/admin/users/${user.userId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: VALID_PASSWORD })

    expect(res.status).toBe(401)
  })

  it('soft-deleted user is excluded from admin list', async () => {
    const user = await registerUser('sd-list')

    await request(app)
      .delete(`/api/admin/users/${user.userId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    const res = await request(app)
      .get('/api/admin/users?search=sd-list')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const found = res.body.data.users.find((u) => u.id === user.userId)
    expect(found).toBeUndefined()
  })

  it('soft-deleted user appears with status=deleted filter', async () => {
    const user = await registerUser('sd-filter')

    await request(app)
      .delete(`/api/admin/users/${user.userId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    const res = await request(app)
      .get('/api/admin/users?status=deleted&search=sd-filter')
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    const found = res.body.data.users.find((u) => u.id === user.userId)
    expect(found).toBeDefined()
    expect(found.deletedAt).not.toBeNull()
  })

  it('restores a soft-deleted user', async () => {
    const user = await registerUser('sd-restore')

    await request(app)
      .delete(`/api/admin/users/${user.userId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    const res = await request(app)
      .post(`/api/admin/users/${user.userId}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data.message).toMatch(/restored/)

    // User should be back in the list
    const listRes = await request(app)
      .get('/api/admin/users?search=sd-restore')
      .set('Authorization', `Bearer ${adminToken}`)

    const found = listRes.body.data.users.find((u) => u.id === user.userId)
    expect(found).toBeDefined()
    expect(found.deletedAt).toBeNull()

    // User can login again
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: VALID_PASSWORD })
    expect(loginRes.status).toBe(200)
  })

  it('returns 404 when restoring a non-deleted user', async () => {
    const user = await registerUser('sd-restore-404')

    const res = await request(app)
      .post(`/api/admin/users/${user.userId}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(404)
  })

  it('admin cannot delete self', async () => {
    // adminToken belongs to the first registered admin user
    const adminUser = createdUserIds[0]

    const res = await request(app)
      .delete(`/api/admin/users/${adminUser}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(400)
  })
})

describe('Soft delete — Organization', () => {
  it('soft-deletes an organization (sets deletedAt, row remains)', async () => {
    const owner = await registerUser('sd-org-owner')
    const orgRes = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'SD Test Org', slug: `sd-org-${RUN_ID}` })

    const orgId = orgRes.body.data.organization.id
    createdOrgIds.push(orgId)

    const res = await request(app)
      .delete(`/api/organizations/${orgId}`)
      .set('Authorization', `Bearer ${owner.token}`)

    expect(res.status).toBe(200)

    // Row still exists
    const dbOrg = await prisma.organization.findFirst({
      where: { id: orgId, deletedAt: { not: null } },
      select: { id: true, deletedAt: true },
    })
    expect(dbOrg).not.toBeNull()
    expect(dbOrg.deletedAt).not.toBeNull()
  })

  it('soft-deleted org is excluded from user org list', async () => {
    const owner = await registerUser('sd-org-list')
    const orgRes = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'SD List Org', slug: `sd-list-${RUN_ID}` })

    const orgId = orgRes.body.data.organization.id
    createdOrgIds.push(orgId)

    await request(app)
      .delete(`/api/organizations/${orgId}`)
      .set('Authorization', `Bearer ${owner.token}`)

    const res = await request(app)
      .get('/api/organizations')
      .set('Authorization', `Bearer ${owner.token}`)

    const found = res.body.data.organizations.find((o) => o.id === orgId)
    expect(found).toBeUndefined()
  })

  it('soft-deleted org is inaccessible via requireTenant', async () => {
    const owner = await registerUser('sd-org-tenant')
    const orgRes = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'SD Tenant Org', slug: `sd-tenant-${RUN_ID}` })

    const orgId = orgRes.body.data.organization.id
    createdOrgIds.push(orgId)

    await request(app)
      .delete(`/api/organizations/${orgId}`)
      .set('Authorization', `Bearer ${owner.token}`)

    const res = await request(app)
      .get(`/api/organizations/${orgId}`)
      .set('Authorization', `Bearer ${owner.token}`)

    expect(res.status).toBe(403)
  })

  it('restores a soft-deleted organization', async () => {
    const owner = await registerUser('sd-org-restore')
    const orgRes = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'SD Restore Org', slug: `sd-restore-${RUN_ID}` })

    const orgId = orgRes.body.data.organization.id
    createdOrgIds.push(orgId)

    await request(app)
      .delete(`/api/organizations/${orgId}`)
      .set('Authorization', `Bearer ${owner.token}`)

    const res = await request(app)
      .post(`/api/organizations/${orgId}/restore`)
      .set('Authorization', `Bearer ${owner.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.message).toMatch(/restored/)

    // Org is accessible again
    const getRes = await request(app)
      .get(`/api/organizations/${orgId}`)
      .set('Authorization', `Bearer ${owner.token}`)

    expect(getRes.status).toBe(200)
  })
})

describe('Soft delete — API Key', () => {
  it('soft-deletes an API key (sets deletedAt, row remains)', async () => {
    const user = await registerUser('sd-key')

    const createRes = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: 'Test Key' })

    const keyId = createRes.body.data.apiKey.id

    const res = await request(app)
      .delete(`/api/api-keys/${keyId}`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(200)

    // Row still exists
    const dbKey = await prisma.apiKey.findFirst({
      where: { id: keyId, deletedAt: { not: null } },
      select: { id: true, deletedAt: true },
    })
    expect(dbKey).not.toBeNull()
    expect(dbKey.deletedAt).not.toBeNull()
  })

  it('soft-deleted API key is excluded from list', async () => {
    const user = await registerUser('sd-key-list')

    const createRes = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: 'Test Key List' })

    const keyId = createRes.body.data.apiKey.id

    await request(app).delete(`/api/api-keys/${keyId}`).set('Authorization', `Bearer ${user.token}`)

    const res = await request(app).get('/api/api-keys').set('Authorization', `Bearer ${user.token}`)

    const found = res.body.data.apiKeys.find((k) => k.id === keyId)
    expect(found).toBeUndefined()
  })

  it('soft-deleted API key cannot be used for verification', async () => {
    const user = await registerUser('sd-key-verify')

    const createRes = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: 'Verify Key', scopes: ['read'] })

    const keyId = createRes.body.data.apiKey.id
    const rawKey = createRes.body.data.key

    await request(app).delete(`/api/api-keys/${keyId}`).set('Authorization', `Bearer ${user.token}`)

    // Try to use the deleted key
    const res = await request(app).get('/api/api-keys').set('Authorization', `Bearer ${rawKey}`)

    expect(res.status).toBe(401)
  })

  it('restores a soft-deleted API key', async () => {
    const user = await registerUser('sd-key-restore')

    const createRes = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: 'Restore Key' })

    const keyId = createRes.body.data.apiKey.id

    await request(app).delete(`/api/api-keys/${keyId}`).set('Authorization', `Bearer ${user.token}`)

    const res = await request(app)
      .post(`/api/api-keys/${keyId}/restore`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.apiKey.deletedAt).toBeNull()

    // Key is back in the list
    const listRes = await request(app)
      .get('/api/api-keys')
      .set('Authorization', `Bearer ${user.token}`)

    const found = listRes.body.data.apiKeys.find((k) => k.id === keyId)
    expect(found).toBeDefined()
  })
})
