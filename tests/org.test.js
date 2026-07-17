import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'

const RUN_ID = Date.now()
const emailFor = (label) => `org-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdEmails = []
const createdOrgIds = []

const registerUser = async (label, overrides = {}) => {
  const email = emailFor(label)
  createdEmails.push(email)
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test User', email, password: VALID_PASSWORD, ...overrides })
  return { email, res }
}

afterAll(async () => {
  // Delete organizations first (cascades to OrganizationMember)
  if (createdOrgIds.length) {
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } })
  }
  await prisma.refreshToken.deleteMany({
    where: { user: { email: { in: createdEmails } } },
  })
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } })
  await prisma.$disconnect()
})

describe('POST /api/organizations', () => {
  it('creates an organization and makes the creator an OWNER member', async () => {
    const { res: registerRes } = await registerUser('create')
    const { token } = registerRes.body.data

    const res = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme Inc', slug: `acme-${RUN_ID}` })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.organization.id).toBeDefined()
    expect(res.body.data.organization.name).toBe('Acme Inc')
    createdOrgIds.push(res.body.data.organization.id)

    // Verify OWNER membership in DB
    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: res.body.data.organization.id,
          userId: registerRes.body.data.user.id,
        },
      },
    })
    expect(membership.role).toBe('OWNER')
  })

  it('rejects duplicate slug', async () => {
    const { res: registerRes } = await registerUser('dup-slug')
    const { token } = registerRes.body.data

    const res1 = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'First Org', slug: `dup-slug-${RUN_ID}` })
    expect(res1.status).toBe(201)
    createdOrgIds.push(res1.body.data.organization.id)

    const res2 = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Second Org', slug: `dup-slug-${RUN_ID}` })

    expect(res2.status).toBe(409)
  })

  it('rejects invalid slug format', async () => {
    const { res: registerRes } = await registerUser('bad-slug')
    const { token } = registerRes.body.data

    const res = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad Org', slug: 'UPPER CASE!' })

    expect(res.status).toBe(400)
    expect(res.body.errors).toBeDefined()
  })

  it('rejects without authentication', async () => {
    const res = await request(app)
      .post('/api/organizations')
      .send({ name: 'No Auth Org', slug: 'no-auth' })

    expect(res.status).toBe(401)
  })
})

describe('GET /api/organizations', () => {
  it('lists organizations the user is a member of', async () => {
    const { res: registerRes } = await registerUser('list')
    const { token } = registerRes.body.data

    const createRes = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'List Org', slug: `list-org-${RUN_ID}` })
    createdOrgIds.push(createRes.body.data.organization.id)

    const res = await request(app)
      .get('/api/organizations')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.organizations.length).toBeGreaterThanOrEqual(1)
    const org = res.body.data.organizations.find((o) => o.slug === `list-org-${RUN_ID}`)
    expect(org).toBeDefined()
    expect(org.role).toBe('OWNER')
  })
})

describe('GET /api/organizations/:orgId', () => {
  it('returns org details for a member', async () => {
    const { res: registerRes } = await registerUser('get-org')
    const { token } = registerRes.body.data

    const createRes = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Get Org', slug: `get-org-${RUN_ID}` })
    const orgId = createRes.body.data.organization.id
    createdOrgIds.push(orgId)

    const res = await request(app)
      .get(`/api/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.organization.id).toBe(orgId)
  })

  it('rejects non-members', async () => {
    const { res: ownerRes } = await registerUser('get-org-owner')
    const { res: outsiderRes } = await registerUser('get-org-outsider')
    const ownerToken = ownerRes.body.data.token
    const outsiderToken = outsiderRes.body.data.token

    const createRes = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Private Org', slug: `private-org-${RUN_ID}` })
    const orgId = createRes.body.data.organization.id
    createdOrgIds.push(orgId)

    const res = await request(app)
      .get(`/api/organizations/${orgId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)

    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/organizations/:orgId', () => {
  it('updates org name as OWNER', async () => {
    const { res: registerRes } = await registerUser('update-org')
    const { token } = registerRes.body.data

    const createRes = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Old Name', slug: `update-org-${RUN_ID}` })
    const orgId = createRes.body.data.organization.id
    createdOrgIds.push(orgId)

    const res = await request(app)
      .patch(`/api/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Name' })

    expect(res.status).toBe(200)
    expect(res.body.data.organization.name).toBe('New Name')
  })

  it('rejects update from a MEMBER', async () => {
    const { res: ownerRes } = await registerUser('update-owner')
    const { res: memberRes } = await registerUser('update-member')
    const ownerToken = ownerRes.body.data.token
    const memberToken = memberRes.body.data.token
    const memberUserId = memberRes.body.data.user.id

    const createRes = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Member Test Org', slug: `member-test-${RUN_ID}` })
    const orgId = createRes.body.data.organization.id
    createdOrgIds.push(orgId)

    // Add member
    await prisma.organizationMember.create({
      data: { organizationId: orgId, userId: memberUserId, role: 'MEMBER' },
    })

    const res = await request(app)
      .patch(`/api/organizations/${orgId}`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'Hacked Name' })

    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/organizations/:orgId', () => {
  it('deletes org as OWNER', async () => {
    const { res: registerRes } = await registerUser('delete-org')
    const { token } = registerRes.body.data

    const createRes = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Delete Me', slug: `delete-me-${RUN_ID}` })
    const orgId = createRes.body.data.organization.id

    const res = await request(app)
      .delete(`/api/organizations/${orgId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)

    // Verify it's gone
    const org = await prisma.organization.findUnique({ where: { id: orgId } })
    expect(org).toBeNull()
  })

  it('rejects delete from non-OWNER', async () => {
    const { res: ownerRes } = await registerUser('del-owner')
    const { res: adminRes } = await registerUser('del-admin')
    const ownerToken = ownerRes.body.data.token
    const adminToken = adminRes.body.data.token
    const adminUserId = adminRes.body.data.user.id

    const createRes = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Admin Del Org', slug: `admin-del-${RUN_ID}` })
    const orgId = createRes.body.data.organization.id
    createdOrgIds.push(orgId)

    // Add admin
    await prisma.organizationMember.create({
      data: { organizationId: orgId, userId: adminUserId, role: 'ADMIN' },
    })

    const res = await request(app)
      .delete(`/api/organizations/${orgId}`)
      .set('Authorization', `Bearer ${adminToken}`)

    expect(res.status).toBe(403)
  })
})

describe('GET /api/organizations/:orgId/members', () => {
  it('lists all members', async () => {
    const { res: registerRes } = await registerUser('list-members')
    const { token } = registerRes.body.data
    const userId = registerRes.body.data.user.id

    const createRes = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Members Org', slug: `members-org-${RUN_ID}` })
    const orgId = createRes.body.data.organization.id
    createdOrgIds.push(orgId)

    const res = await request(app)
      .get(`/api/organizations/${orgId}/members`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.members).toHaveLength(1)
    expect(res.body.data.members[0].role).toBe('OWNER')
    expect(res.body.data.members[0].user.id).toBe(userId)
  })
})

describe('PATCH /api/organizations/:orgId/members/:userId', () => {
  it('promotes a MEMBER to ADMIN', async () => {
    const { res: ownerRes } = await registerUser('promote-owner')
    const { res: memberRes } = await registerUser('promote-member')
    const ownerToken = ownerRes.body.data.token
    const memberUserId = memberRes.body.data.user.id

    const createRes = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Promote Org', slug: `promote-org-${RUN_ID}` })
    const orgId = createRes.body.data.organization.id
    createdOrgIds.push(orgId)

    await prisma.organizationMember.create({
      data: { organizationId: orgId, userId: memberUserId, role: 'MEMBER' },
    })

    const res = await request(app)
      .patch(`/api/organizations/${orgId}/members/${memberUserId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'ADMIN' })

    expect(res.status).toBe(200)
    expect(res.body.data.member.role).toBe('ADMIN')
  })

  it('rejects changing the OWNER role', async () => {
    const { res: ownerRes } = await registerUser('owner-change')
    const { token } = ownerRes.body.data
    const ownerUserId = ownerRes.body.data.user.id

    const createRes = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Owner Change Org', slug: `owner-change-${RUN_ID}` })
    const orgId = createRes.body.data.organization.id
    createdOrgIds.push(orgId)

    const res = await request(app)
      .patch(`/api/organizations/${orgId}/members/${ownerUserId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'MEMBER' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/owner/i)
  })
})

describe('DELETE /api/organizations/:orgId/members/:userId', () => {
  it('removes a member', async () => {
    const { res: ownerRes } = await registerUser('remove-owner')
    const { res: memberRes } = await registerUser('remove-member')
    const ownerToken = ownerRes.body.data.token
    const memberUserId = memberRes.body.data.user.id

    const createRes = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Remove Org', slug: `remove-org-${RUN_ID}` })
    const orgId = createRes.body.data.organization.id
    createdOrgIds.push(orgId)

    await prisma.organizationMember.create({
      data: { organizationId: orgId, userId: memberUserId, role: 'MEMBER' },
    })

    const res = await request(app)
      .delete(`/api/organizations/${orgId}/members/${memberUserId}`)
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(res.status).toBe(200)

    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId: memberUserId },
      },
    })
    expect(membership).toBeNull()
  })

  it('rejects removing the OWNER', async () => {
    const { res: ownerRes } = await registerUser('rm-owner-self')
    const { token } = ownerRes.body.data
    const ownerUserId = ownerRes.body.data.user.id

    const createRes = await request(app)
      .post('/api/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Rm Owner Org', slug: `rm-owner-${RUN_ID}` })
    const orgId = createRes.body.data.organization.id
    createdOrgIds.push(orgId)

    const res = await request(app)
      .delete(`/api/organizations/${orgId}/members/${ownerUserId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/owner/i)
  })
})
