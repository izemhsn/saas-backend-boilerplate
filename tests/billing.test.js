import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'

const RUN_ID = Date.now()
const emailFor = (label) => `billing-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdEmails = []
const createdUserIds = []
const createdPlanIds = []

const registerUser = async (label, overrides = {}) => {
  const email = emailFor(label)
  createdEmails.push(email)
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test User', email, password: VALID_PASSWORD, ...overrides })
  createdUserIds.push(res.body.data.user.id)
  return { email, res }
}

beforeAll(async () => {
  // Seed test plans
  const free = await prisma.plan.create({
    data: {
      name: 'Free',
      description: 'Free tier',
      stripePriceId: `price_free_${RUN_ID}`,
      priceCents: 0,
      currency: 'usd',
      interval: 'MONTH',
      features: { maxProjects: 1 },
      active: true,
    },
  })
  const pro = await prisma.plan.create({
    data: {
      name: 'Pro',
      description: 'Pro tier',
      stripePriceId: `price_pro_${RUN_ID}`,
      priceCents: 1999,
      currency: 'usd',
      interval: 'MONTH',
      features: { maxProjects: 50 },
      active: true,
    },
  })
  const enterprise = await prisma.plan.create({
    data: {
      name: 'Enterprise',
      description: 'Enterprise tier',
      stripePriceId: `price_ent_${RUN_ID}`,
      priceCents: 9999,
      currency: 'usd',
      interval: 'YEAR',
      features: { maxProjects: -1 },
      active: true,
    },
  })
  createdPlanIds.push(free.id, pro.id, enterprise.id)
})

afterAll(async () => {
  // Clean up subscriptions first (if any)
  await prisma.subscription.deleteMany({
    where: { userId: { in: createdUserIds } },
  })
  await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } })
  await prisma.refreshToken.deleteMany({
    where: { user: { email: { in: createdEmails } } },
  })
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } })
  await prisma.$disconnect()
})

describe('GET /api/billing/plans', () => {
  it('lists active plans', async () => {
    const res = await request(app).get('/api/billing/plans')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.plans.length).toBeGreaterThanOrEqual(3)
    expect(res.body.data.pagination).toBeDefined()
  })

  it('filters by interval', async () => {
    const res = await request(app).get('/api/billing/plans?interval=YEAR')

    expect(res.status).toBe(200)
    expect(res.body.data.plans.every((p) => p.interval === 'YEAR')).toBe(true)
  })

  it('sorts by priceCents ascending', async () => {
    const res = await request(app).get('/api/billing/plans?sort=priceCents&order=asc')

    expect(res.status).toBe(200)
    const prices = res.body.data.plans.map((p) => p.priceCents)
    const sorted = [...prices].sort((a, b) => a - b)
    expect(prices).toEqual(sorted)
  })
})

describe('GET /api/billing/subscription', () => {
  it('returns null subscription for user without one', async () => {
    const { res: registerRes } = await registerUser('no-sub')
    const { token } = registerRes.body.data

    const res = await request(app)
      .get('/api/billing/subscription')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.subscription).toBeNull()
  })

  it('returns subscription when user has an active one', async () => {
    const { res: registerRes } = await registerUser('with-sub')
    const { token } = registerRes.body.data
    const userId = registerRes.body.data.user.id

    const plan = await prisma.plan.findFirst({ where: { name: 'Pro' } })
    await prisma.subscription.create({
      data: {
        userId,
        planId: plan.id,
        stripeSubscriptionId: `sub_test_${RUN_ID}`,
        stripeCustomerId: `cus_test_${RUN_ID}`,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    const res = await request(app)
      .get('/api/billing/subscription')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.subscription).not.toBeNull()
    expect(res.body.data.subscription.status).toBe('ACTIVE')
    expect(res.body.data.subscription.plan.name).toBe('Pro')
  })

  it('rejects unauthenticated request', async () => {
    const res = await request(app).get('/api/billing/subscription')

    expect(res.status).toBe(401)
  })
})

describe('POST /api/billing/checkout', () => {
  it('rejects when Stripe is not configured', async () => {
    const { res: registerRes } = await registerUser('checkout')
    const { token } = registerRes.body.data

    const plan = await prisma.plan.findFirst({ where: { name: 'Free' } })
    const res = await request(app)
      .post('/api/billing/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({
        planId: plan.id,
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      })

    expect(res.status).toBe(500)
    expect(res.body.message).toMatch(/stripe/i)
  })

  it('rejects invalid plan ID', async () => {
    const { res: registerRes } = await registerUser('bad-plan')
    const { token } = registerRes.body.data

    const res = await request(app)
      .post('/api/billing/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({
        planId: 'nonexistent-plan-id',
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      })

    expect(res.status).toBe(404)
  })

  it('rejects invalid URLs', async () => {
    const { res: registerRes } = await registerUser('bad-url')
    const { token } = registerRes.body.data

    const plan = await prisma.plan.findFirst({ where: { name: 'Free' } })
    const res = await request(app)
      .post('/api/billing/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({
        planId: plan.id,
        successUrl: 'not-a-url',
        cancelUrl: 'also-not-a-url',
      })

    expect(res.status).toBe(400)
    expect(res.body.errors).toBeDefined()
  })

  it('rejects unauthenticated request', async () => {
    const plan = await prisma.plan.findFirst({ where: { name: 'Free' } })
    const res = await request(app)
      .post('/api/billing/checkout')
      .send({
        planId: plan.id,
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      })

    expect(res.status).toBe(401)
  })
})

describe('POST /api/billing/portal', () => {
  it('rejects when user has no Stripe customer ID', async () => {
    const { res: registerRes } = await registerUser('no-customer')
    const { token } = registerRes.body.data

    const res = await request(app)
      .post('/api/billing/portal')
      .set('Authorization', `Bearer ${token}`)
      .send({ returnUrl: 'http://localhost:3000/dashboard' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/no billing account/i)
  })
})

describe('POST /api/billing/cancel', () => {
  it('rejects when no active subscription', async () => {
    const { res: registerRes } = await registerUser('no-cancel')
    const { token } = registerRes.body.data

    const res = await request(app)
      .post('/api/billing/cancel')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})

describe('POST /api/billing/webhook', () => {
  it('rejects without Stripe signature header', async () => {
    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'test' }))

    expect(res.status).toBe(400)
  })
})
