import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'

// Integration tests for org-scoped billing (M12) — the organization owns the
// subscription instead of a member personally. Mirrors tests/billing.test.js,
// scoped through /api/organizations/:orgId/billing/* and requireTenant +
// requireOrgRole instead of a bare authenticate.

const RUN_ID = Date.now()
const emailFor = (label) => `billing-org-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdEmails = []
const createdOrgIds = []
const createdPlanIds = []

const registerUser = async (label) => {
  const email = emailFor(label)
  createdEmails.push(email)
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test User', email, password: VALID_PASSWORD })
  return { email, token: res.body.data.token, userId: res.body.data.user.id }
}

const createOrg = async (token, slug) => {
  const res = await request(app)
    .post('/api/organizations')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `Org ${slug}`, slug: `${slug}-${RUN_ID}` })
  createdOrgIds.push(res.body.data.organization.id)
  return res.body.data.organization.id
}

let owner
let member
let orgId
let freePlanId

beforeAll(async () => {
  owner = await registerUser('owner')
  member = await registerUser('member')
  orgId = await createOrg(owner.token, 'main')
  await prisma.organizationMember.create({
    data: { organizationId: orgId, userId: member.userId, role: 'MEMBER' },
  })

  const plan = await prisma.plan.create({
    data: {
      name: `Org Billing Free ${RUN_ID}`,
      code: `org-billing-free-${RUN_ID}`,
      stripePriceId: `price_org_billing_free_${RUN_ID}`,
      priceCents: 0,
      currency: 'usd',
      interval: 'MONTH',
      active: true,
    },
  })
  freePlanId = plan.id
  createdPlanIds.push(plan.id)
})

afterAll(async () => {
  await prisma.subscription.deleteMany({ where: { organizationId: { in: createdOrgIds } } })
  await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } })
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } })
  await prisma.refreshToken.deleteMany({ where: { user: { email: { in: createdEmails } } } })
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } })
  await prisma.$disconnect()
})

describe('GET /api/organizations/:orgId/billing/subscription', () => {
  it('returns null subscription for an org without one', async () => {
    const res = await request(app)
      .get(`/api/organizations/${orgId}/billing/subscription`)
      .set('Authorization', `Bearer ${owner.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.subscription).toBeNull()
  })

  it('any member (not just OWNER/ADMIN) can read it', async () => {
    const res = await request(app)
      .get(`/api/organizations/${orgId}/billing/subscription`)
      .set('Authorization', `Bearer ${member.token}`)

    expect(res.status).toBe(200)
  })

  it('returns the org subscription, scoped to organizationId not userId', async () => {
    const sub = await prisma.subscription.create({
      data: {
        organizationId: orgId,
        planId: freePlanId,
        stripeSubscriptionId: `sub_org_test_${RUN_ID}`,
        stripeCustomerId: `cus_org_test_${RUN_ID}`,
        status: 'ACTIVE',
      },
    })

    const res = await request(app)
      .get(`/api/organizations/${orgId}/billing/subscription`)
      .set('Authorization', `Bearer ${owner.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.subscription.id).toBe(sub.id)

    await prisma.subscription.delete({ where: { id: sub.id } })
  })

  it('rejects a non-member', async () => {
    const outsider = await registerUser('outsider')
    const res = await request(app)
      .get(`/api/organizations/${orgId}/billing/subscription`)
      .set('Authorization', `Bearer ${outsider.token}`)

    expect(res.status).toBe(403)
  })
})

describe('POST /api/organizations/:orgId/billing/checkout', () => {
  it('rejects a plain MEMBER — billing actions require OWNER/ADMIN', async () => {
    const res = await request(app)
      .post(`/api/organizations/${orgId}/billing/checkout`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({
        planId: freePlanId,
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      })

    expect(res.status).toBe(403)
  })

  it('rejects when Stripe is not configured, for the OWNER', async () => {
    const res = await request(app)
      .post(`/api/organizations/${orgId}/billing/checkout`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        planId: freePlanId,
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      })

    expect(res.status).toBe(500)
    expect(res.body.message).toMatch(/stripe/i)
  })

  it('rejects an invalid plan ID', async () => {
    const res = await request(app)
      .post(`/api/organizations/${orgId}/billing/checkout`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        planId: 'nonexistent-plan-id',
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      })

    expect(res.status).toBe(404)
  })
})

describe('POST /api/organizations/:orgId/billing/portal', () => {
  it('rejects a plain MEMBER', async () => {
    const res = await request(app)
      .post(`/api/organizations/${orgId}/billing/portal`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({ returnUrl: 'http://localhost:3000/dashboard' })

    expect(res.status).toBe(403)
  })

  it('rejects when the org has no Stripe customer ID, for the OWNER', async () => {
    const res = await request(app)
      .post(`/api/organizations/${orgId}/billing/portal`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ returnUrl: 'http://localhost:3000/dashboard' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/no billing account/i)
  })
})

describe('POST /api/organizations/:orgId/billing/cancel', () => {
  it('rejects a plain MEMBER', async () => {
    const res = await request(app)
      .post(`/api/organizations/${orgId}/billing/cancel`)
      .set('Authorization', `Bearer ${member.token}`)

    expect(res.status).toBe(403)
  })

  it('rejects when there is no active subscription, for the OWNER', async () => {
    const res = await request(app)
      .post(`/api/organizations/${orgId}/billing/cancel`)
      .set('Authorization', `Bearer ${owner.token}`)

    expect(res.status).toBe(404)
  })
})
