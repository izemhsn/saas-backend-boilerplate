import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'
import { createHash } from 'crypto'

const RUN_ID = Date.now()
const emailFor = (label) => `inv-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdEmails = []
const createdUserIds = []
const createdOrgIds = []
const createdInvitationIds = []

const registerUser = async (label) => {
  const email = emailFor(label)
  createdEmails.push(email)
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: `Test ${label}`, email, password: VALID_PASSWORD })
  createdUserIds.push(res.body.data.user.id)
  return { email, res }
}

const createOrg = async (token, label) => {
  const res = await request(app)
    .post('/api/organizations')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `Org ${label}`, slug: `org-${label}-${RUN_ID}` })
  createdOrgIds.push(res.body.data.organization.id)
  return res
}

afterAll(async () => {
  if (createdInvitationIds.length) {
    await prisma.organizationInvitation.deleteMany({ where: { id: { in: createdInvitationIds } } })
  }
  if (createdOrgIds.length) {
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } })
  }
  await prisma.auditLog.deleteMany({
    where: { OR: [{ userId: { in: createdUserIds } }, { targetUserId: { in: createdUserIds } }] },
  })
  await prisma.refreshToken.deleteMany({
    where: { user: { email: { in: createdEmails } } },
  })
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } })
  await prisma.$disconnect()
})

describe('POST /api/organizations/:orgId/invitations', () => {
  it('creates an invitation for a non-member', async () => {
    const { res: ownerRes } = await registerUser('owner-create')
    const { token } = ownerRes.body.data
    const orgRes = await createOrg(token, 'create')
    const orgId = orgRes.body.data.organization.id

    const inviteeEmail = emailFor('invitee-create')
    createdEmails.push(inviteeEmail)

    const res = await request(app)
      .post(`/api/organizations/${orgId}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: inviteeEmail, role: 'MEMBER' })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.invitation.status).toBe('PENDING')
    expect(res.body.data.invitation.inviteeEmail).toBe(inviteeEmail)
    expect(res.body.data.invitation.role).toBe('MEMBER')
    createdInvitationIds.push(res.body.data.invitation.id)
  })

  it('rejects invitation for an existing member', async () => {
    const { res: ownerRes } = await registerUser('owner-member')
    const { token } = ownerRes.body.data
    const orgRes = await createOrg(token, 'member-check')
    const orgId = orgRes.body.data.organization.id

    const res = await request(app)
      .post(`/api/organizations/${orgId}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: ownerRes.body.data.user.email, role: 'MEMBER' })

    expect(res.status).toBe(409)
  })

  it('rejects duplicate pending invitation', async () => {
    const { res: ownerRes } = await registerUser('owner-dup')
    const { token } = ownerRes.body.data
    const orgRes = await createOrg(token, 'dup-check')
    const orgId = orgRes.body.data.organization.id

    const inviteeEmail = emailFor('dup-invitee')
    createdEmails.push(inviteeEmail)

    await request(app)
      .post(`/api/organizations/${orgId}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: inviteeEmail, role: 'MEMBER' })

    const res = await request(app)
      .post(`/api/organizations/${orgId}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: inviteeEmail, role: 'ADMIN' })

    expect(res.status).toBe(409)

    // Cleanup
    const inv = await prisma.organizationInvitation.findFirst({
      where: { organizationId: orgId, inviteeEmail },
    })
    if (inv) createdInvitationIds.push(inv.id)
  })

  it('rejects OWNER role invitation', async () => {
    const { res: ownerRes } = await registerUser('owner-role')
    const { token } = ownerRes.body.data
    const orgRes = await createOrg(token, 'role-check')
    const orgId = orgRes.body.data.organization.id

    const res = await request(app)
      .post(`/api/organizations/${orgId}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: emailFor('owner-target'), role: 'OWNER' })

    expect(res.status).toBe(400)
  })

  it('rejects non-admin/member creating invitation', async () => {
    const { res: ownerRes } = await registerUser('owner-access')
    const { token: ownerToken } = ownerRes.body.data
    const orgRes = await createOrg(ownerToken, 'access-check')
    const orgId = orgRes.body.data.organization.id

    const { res: outsiderRes } = await registerUser('outsider-access')
    const { token: outsiderToken } = outsiderRes.body.data

    const res = await request(app)
      .post(`/api/organizations/${orgId}/invitations`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ email: emailFor('access-target'), role: 'MEMBER' })

    expect(res.status).toBe(403)
  })
})

describe('GET /api/organizations/:orgId/invitations', () => {
  it('lists invitations for an org', async () => {
    const { res: ownerRes } = await registerUser('owner-list')
    const { token } = ownerRes.body.data
    const orgRes = await createOrg(token, 'list')
    const orgId = orgRes.body.data.organization.id

    const inviteeEmail = emailFor('list-invitee')
    createdEmails.push(inviteeEmail)

    await request(app)
      .post(`/api/organizations/${orgId}/invitations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ email: inviteeEmail, role: 'MEMBER' })

    const res = await request(app)
      .get(`/api/organizations/${orgId}/invitations`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.invitations.length).toBeGreaterThanOrEqual(1)
    expect(res.body.data.pagination).toBeDefined()

    const inv = await prisma.organizationInvitation.findFirst({
      where: { organizationId: orgId, inviteeEmail },
    })
    if (inv) createdInvitationIds.push(inv.id)
  })
})

describe('POST /api/invitations/accept', () => {
  it('accepts an invitation with a valid raw token', async () => {
    const { res: ownerRes } = await registerUser('owner-accept2')
    const { token: ownerToken } = ownerRes.body.data
    const orgRes = await createOrg(ownerToken, 'accept2')
    const orgId = orgRes.body.data.organization.id

    const { res: inviteeRes } = await registerUser('invitee-accept2')
    const { token: inviteeToken } = inviteeRes.body.data
    const inviteeEmail = inviteeRes.body.data.user.email

    // Create invitation directly in DB with known token
    const rawToken = 'test-accept-token-' + RUN_ID
    const invitation = await prisma.organizationInvitation.create({
      data: {
        organizationId: orgId,
        inviterId: ownerRes.body.data.user.id,
        inviteeEmail,
        inviteeId: inviteeRes.body.data.user.id,
        role: 'MEMBER',
        status: 'PENDING',
        token: createHash('sha256').update(rawToken).digest('hex'),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
    createdInvitationIds.push(invitation.id)

    const res = await request(app)
      .post('/api/invitations/accept')
      .set('Authorization', `Bearer ${inviteeToken}`)
      .send({ token: rawToken })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.invitation.status).toBe('ACCEPTED')

    // Verify membership
    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId: inviteeRes.body.data.user.id },
      },
    })
    expect(membership).toBeTruthy()
    expect(membership.role).toBe('MEMBER')
  })

  it('rejects accepting an invitation meant for another user', async () => {
    const { res: ownerRes } = await registerUser('owner-mismatch')
    const { token: ownerToken } = ownerRes.body.data
    const orgRes = await createOrg(ownerToken, 'mismatch')
    const orgId = orgRes.body.data.organization.id

    const { res: inviteeRes } = await registerUser('invitee-mismatch')
    const { res: otherRes } = await registerUser('other-mismatch')
    const { token: otherToken } = otherRes.body.data

    const rawToken = 'test-mismatch-token-' + RUN_ID
    const invitation = await prisma.organizationInvitation.create({
      data: {
        organizationId: orgId,
        inviterId: ownerRes.body.data.user.id,
        inviteeEmail: inviteeRes.body.data.user.email,
        inviteeId: inviteeRes.body.data.user.id,
        role: 'MEMBER',
        status: 'PENDING',
        token: createHash('sha256').update(rawToken).digest('hex'),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
    createdInvitationIds.push(invitation.id)

    const res = await request(app)
      .post('/api/invitations/accept')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ token: rawToken })

    expect(res.status).toBe(403)
  })
})

describe('POST /api/invitations/decline', () => {
  it('declines an invitation', async () => {
    const { res: ownerRes } = await registerUser('owner-decline')
    const { token: ownerToken } = ownerRes.body.data
    const orgRes = await createOrg(ownerToken, 'decline')
    const orgId = orgRes.body.data.organization.id

    const { res: inviteeRes } = await registerUser('invitee-decline')
    const { token: inviteeToken } = inviteeRes.body.data
    const inviteeEmail = inviteeRes.body.data.user.email

    const rawToken = 'test-decline-token-' + RUN_ID
    const invitation = await prisma.organizationInvitation.create({
      data: {
        organizationId: orgId,
        inviterId: ownerRes.body.data.user.id,
        inviteeEmail,
        inviteeId: inviteeRes.body.data.user.id,
        role: 'MEMBER',
        status: 'PENDING',
        token: createHash('sha256').update(rawToken).digest('hex'),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
    createdInvitationIds.push(invitation.id)

    const res = await request(app)
      .post('/api/invitations/decline')
      .set('Authorization', `Bearer ${inviteeToken}`)
      .send({ token: rawToken })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.invitation.status).toBe('DECLINED')
  })
})

describe('DELETE /api/organizations/:orgId/invitations/:invitationId', () => {
  it('cancels a pending invitation', async () => {
    const { res: ownerRes } = await registerUser('owner-cancel')
    const { token: ownerToken } = ownerRes.body.data
    const orgRes = await createOrg(ownerToken, 'cancel')
    const orgId = orgRes.body.data.organization.id

    const inviteeEmail = emailFor('cancel-invitee')
    createdEmails.push(inviteeEmail)

    const createRes = await request(app)
      .post(`/api/organizations/${orgId}/invitations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: inviteeEmail, role: 'MEMBER' })

    const invitationId = createRes.body.data.invitation.id
    createdInvitationIds.push(invitationId)

    const res = await request(app)
      .delete(`/api/organizations/${orgId}/invitations/${invitationId}`)
      .set('Authorization', `Bearer ${ownerToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.invitation.status).toBe('CANCELED')
  })
})

describe('GET /api/invitations/me', () => {
  it('lists pending invitations for the current user', async () => {
    const { res: ownerRes } = await registerUser('owner-melist')
    const { token: ownerToken } = ownerRes.body.data
    const orgRes = await createOrg(ownerToken, 'melist')
    const orgId = orgRes.body.data.organization.id

    const { res: inviteeRes } = await registerUser('invitee-melist')
    const { token: inviteeToken } = inviteeRes.body.data
    const inviteeEmail = inviteeRes.body.data.user.email

    const rawToken = 'test-melist-token-' + RUN_ID
    const invitation = await prisma.organizationInvitation.create({
      data: {
        organizationId: orgId,
        inviterId: ownerRes.body.data.user.id,
        inviteeEmail,
        inviteeId: inviteeRes.body.data.user.id,
        role: 'MEMBER',
        status: 'PENDING',
        token: createHash('sha256').update(rawToken).digest('hex'),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
    createdInvitationIds.push(invitation.id)

    const res = await request(app)
      .get('/api/invitations/me')
      .set('Authorization', `Bearer ${inviteeToken}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.invitations.length).toBeGreaterThanOrEqual(1)
    const found = res.body.data.invitations.find((i) => i.id === invitation.id)
    expect(found).toBeTruthy()
    expect(found.status).toBe('PENDING')
  })
})
