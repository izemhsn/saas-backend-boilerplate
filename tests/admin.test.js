import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'

const RUN_ID = Date.now()
const emailFor = (label) => `admin-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdEmails = []

const registerUser = async (label, overrides = {}) => {
  const email = emailFor(label)
  createdEmails.push(email)
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test User', email, password: VALID_PASSWORD, ...overrides })
  return { email, res }
}

const createAdmin = async (label) => {
  const { email, res } = await registerUser(label)
  await prisma.user.update({
    where: { id: res.body.data.user.id },
    data: { role: 'ADMIN' },
  })
  // Re-login to get a token with the ADMIN role
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email, password: VALID_PASSWORD })
  return { email, userId: res.body.data.user.id, token: loginRes.body.data.token }
}

afterAll(async () => {
  await prisma.refreshToken.deleteMany({
    where: { user: { email: { in: createdEmails } } },
  })
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } })
  await prisma.$disconnect()
})

describe('Admin route authorization', () => {
  it('rejects without authentication', async () => {
    const res = await request(app).get('/api/admin/users')
    expect(res.status).toBe(401)
  })

  it('rejects non-admin user', async () => {
    const { res: registerRes } = await registerUser('non-admin')
    const { token } = registerRes.body.data

    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })
})

describe('GET /api/admin/users', () => {
  it('returns paginated user list', async () => {
    const admin = await createAdmin('list-admin')

    const res = await request(app)
      .get('/api/admin/users?page=1&limit=5')
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.users).toBeInstanceOf(Array)
    expect(res.body.data.users.length).toBeLessThanOrEqual(5)
    expect(res.body.data.pagination).toBeDefined()
    expect(res.body.data.pagination.page).toBe(1)
    expect(res.body.data.pagination.limit).toBe(5)
    expect(res.body.data.pagination.total).toBeGreaterThan(0)
  })

  it('filters by search term', async () => {
    const admin = await createAdmin('search-admin')
    const { res: registerRes } = await registerUser('search-target')
    const targetEmail = registerRes.body.data.user.email

    const res = await request(app)
      .get(`/api/admin/users?search=${encodeURIComponent('search-target')}`)
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.users.some((u) => u.email === targetEmail)).toBe(true)
  })

  it('filters by role', async () => {
    const admin = await createAdmin('role-filter-admin')

    const res = await request(app)
      .get('/api/admin/users?role=ADMIN')
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.users.every((u) => u.role === 'ADMIN')).toBe(true)
  })

  it('filters by banned status', async () => {
    const admin = await createAdmin('banned-filter-admin')
    const { res: registerRes } = await registerUser('banned-filter-target')
    const targetId = registerRes.body.data.user.id

    await prisma.user.update({
      where: { id: targetId },
      data: { banned: true, bannedAt: new Date() },
    })

    const res = await request(app)
      .get('/api/admin/users?status=banned')
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.users.every((u) => u.banned === true)).toBe(true)
    expect(res.body.data.users.some((u) => u.id === targetId)).toBe(true)
  })

  it('respects sort and order params', async () => {
    const admin = await createAdmin('sort-admin')

    const res = await request(app)
      .get('/api/admin/users?sort=email&order=asc&limit=10')
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(200)
    const emails = res.body.data.users.map((u) => u.email)
    const sorted = [...emails].sort()
    expect(emails).toEqual(sorted)
  })
})

describe('GET /api/admin/users/:userId', () => {
  it('returns a single user', async () => {
    const admin = await createAdmin('get-one-admin')
    const { res: registerRes } = await registerUser('get-one-target')
    const targetId = registerRes.body.data.user.id

    const res = await request(app)
      .get(`/api/admin/users/${targetId}`)
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.user.id).toBe(targetId)
    expect(res.body.data.user.email).toBe(registerRes.body.data.user.email)
  })

  it('returns 404 for non-existent user', async () => {
    const admin = await createAdmin('get-404-admin')

    const res = await request(app)
      .get('/api/admin/users/nonexistent-id')
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/admin/users/:userId', () => {
  it('updates user role to ADMIN', async () => {
    const admin = await createAdmin('promote-admin')
    const { res: registerRes } = await registerUser('promote-target')
    const targetId = registerRes.body.data.user.id

    const res = await request(app)
      .patch(`/api/admin/users/${targetId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ role: 'ADMIN' })

    expect(res.status).toBe(200)
    expect(res.body.data.user.role).toBe('ADMIN')
  })

  it('updates user name', async () => {
    const admin = await createAdmin('name-admin')
    const { res: registerRes } = await registerUser('name-target')
    const targetId = registerRes.body.data.user.id

    const res = await request(app)
      .patch(`/api/admin/users/${targetId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'Updated Name' })

    expect(res.status).toBe(200)
    expect(res.body.data.user.name).toBe('Updated Name')
  })

  it('bans a user', async () => {
    const admin = await createAdmin('ban-admin')
    const { res: registerRes } = await registerUser('ban-target')
    const targetId = registerRes.body.data.user.id

    const res = await request(app)
      .patch(`/api/admin/users/${targetId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ banned: true })

    expect(res.status).toBe(200)
    expect(res.body.data.user.banned).toBe(true)
    expect(res.body.data.user.bannedAt).toBeDefined()
  })

  it('unbans a user', async () => {
    const admin = await createAdmin('unban-admin')
    const { res: registerRes } = await registerUser('unban-target')
    const targetId = registerRes.body.data.user.id

    await prisma.user.update({
      where: { id: targetId },
      data: { banned: true, bannedAt: new Date() },
    })

    const res = await request(app)
      .patch(`/api/admin/users/${targetId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ banned: false })

    expect(res.status).toBe(200)
    expect(res.body.data.user.banned).toBe(false)
    expect(res.body.data.user.bannedAt).toBeNull()
  })

  it('suspends a user until a future date', async () => {
    const admin = await createAdmin('suspend-admin')
    const { res: registerRes } = await registerUser('suspend-target')
    const targetId = registerRes.body.data.user.id

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

    const res = await request(app)
      .patch(`/api/admin/users/${targetId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ suspendedUntil: future })

    expect(res.status).toBe(200)
    expect(res.body.data.user.suspendedUntil).toBeDefined()
  })

  it('lifts suspension by setting null', async () => {
    const admin = await createAdmin('unsuspend-admin')
    const { res: registerRes } = await registerUser('unsuspend-target')
    const targetId = registerRes.body.data.user.id

    await prisma.user.update({
      where: { id: targetId },
      data: { suspendedUntil: new Date(Date.now() + 60 * 60 * 1000) },
    })

    const res = await request(app)
      .patch(`/api/admin/users/${targetId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ suspendedUntil: null })

    expect(res.status).toBe(200)
    expect(res.body.data.user.suspendedUntil).toBeNull()
  })

  it('returns 404 for non-existent user', async () => {
    const admin = await createAdmin('patch-404-admin')

    const res = await request(app)
      .patch('/api/admin/users/nonexistent-id')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'No One' })

    expect(res.status).toBe(404)
  })

  it('rejects empty update body', async () => {
    const admin = await createAdmin('empty-patch-admin')
    const { res: registerRes } = await registerUser('empty-patch-target')
    const targetId = registerRes.body.data.user.id

    const res = await request(app)
      .patch(`/api/admin/users/${targetId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.errors).toBeDefined()
  })
})

describe('DELETE /api/admin/users/:userId', () => {
  it('deletes a user', async () => {
    const admin = await createAdmin('delete-admin')
    const { res: registerRes } = await registerUser('delete-target')
    const targetId = registerRes.body.data.user.id

    const res = await request(app)
      .delete(`/api/admin/users/${targetId}`)
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.message).toMatch(/deleted/i)

    const user = await prisma.user.findUnique({ where: { id: targetId } })
    expect(user).toBeNull()
  })

  it('returns 404 for non-existent user', async () => {
    const admin = await createAdmin('delete-404-admin')

    const res = await request(app)
      .delete('/api/admin/users/nonexistent-id')
      .set('Authorization', `Bearer ${admin.token}`)

    expect(res.status).toBe(404)
  })
})

describe('Ban/Suspend enforcement', () => {
  it('banned user cannot authenticate', async () => {
    const { res: registerRes } = await registerUser('ban-enforce-target')
    const targetId = registerRes.body.data.user.id
    const targetToken = registerRes.body.data.token

    await prisma.user.update({
      where: { id: targetId },
      data: { banned: true, bannedAt: new Date() },
    })

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${targetToken}`)

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/banned/i)

    // Cleanup: unban so afterAll can delete
    await prisma.user.update({
      where: { id: targetId },
      data: { banned: false, bannedAt: null },
    })
  })

  it('banned user cannot login', async () => {
    const { email } = await registerUser('ban-login-target')
    const targetUser = await prisma.user.findUnique({ where: { email } })

    await prisma.user.update({
      where: { id: targetUser.id },
      data: { banned: true, bannedAt: new Date() },
    })

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: VALID_PASSWORD })

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/banned/i)

    // Cleanup
    await prisma.user.update({
      where: { id: targetUser.id },
      data: { banned: false, bannedAt: null },
    })
  })

  it('suspended user cannot login', async () => {
    const { email: suspendEmail } = await registerUser('suspend-login-target')
    const targetUser = await prisma.user.findUnique({ where: { email: suspendEmail } })

    await prisma.user.update({
      where: { id: targetUser.id },
      data: { suspendedUntil: new Date(Date.now() + 60 * 60 * 1000) },
    })

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: suspendEmail, password: VALID_PASSWORD })

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/suspended/i)

    // Cleanup
    await prisma.user.update({
      where: { id: targetUser.id },
      data: { suspendedUntil: null },
    })
  })
})
