import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'
import { createApiKey } from '../src/modules/apikey/apikey.service.js'
import { authenticateApiKey, requireScope } from '../src/middleware/apiKey.middleware.js'
import { requireSubscription, requirePlan } from '../src/middleware/subscription.middleware.js'
import { requireFeatureFlag } from '../src/middleware/featureflag.middleware.js'

const RUN_ID = Date.now()
const emailFor = (label) => `mw-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdEmails = []
const createdUserIds = []
const createdKeyIds = []
const createdSubscriptionIds = []
const createdFlagKeys = []
const createdPlanIds = []

// Plans are created in beforeAll with unique names so this file is fully
// self-contained — it must not depend on seed data or on billing.test.js
// (which runs in a parallel worker and creates/deletes its own plans).
// A fresh CI database has no plans at all, so relying on findFirst by a
// shared name ('Pro'/'Free') is a race that fails on clean databases.
let proPlan
let freePlan

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
  proPlan = await prisma.plan.create({
    data: {
      name: `Pro-mw-${RUN_ID}`,
      description: 'Middleware test Pro plan',
      stripePriceId: `price_mw_pro_${RUN_ID}`,
      priceCents: 1999,
      currency: 'usd',
      interval: 'MONTH',
      features: { maxProjects: 50 },
      active: true,
    },
  })
  freePlan = await prisma.plan.create({
    data: {
      name: `Free-mw-${RUN_ID}`,
      description: 'Middleware test Free plan',
      stripePriceId: `price_mw_free_${RUN_ID}`,
      priceCents: 0,
      currency: 'usd',
      interval: 'MONTH',
      features: { maxProjects: 1 },
      active: true,
    },
  })
  createdPlanIds.push(proPlan.id, freePlan.id)
})

afterAll(async () => {
  await prisma.subscription.deleteMany({ where: { id: { in: createdSubscriptionIds } } })
  await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } })
  await prisma.apiKey.deleteMany({ where: { id: { in: createdKeyIds } } })
  await prisma.featureFlag.deleteMany({ where: { key: { in: createdFlagKeys } } })
  await prisma.refreshToken.deleteMany({
    where: { user: { email: { in: createdEmails } } },
  })
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } })
  await prisma.$disconnect()
})

// ── Helper: build a tiny Express app with just the middleware under test ──
const buildApp = (...middleware) => {
  const testApp = express()
  testApp.use(express.json())
  testApp.get('/test', ...middleware, (req, res) => {
    res.json({
      success: true,
      user: req.user,
      apiKey: req.apiKey,
      subscription: req.subscription,
      featureFlag: req.featureFlag,
    })
  })
  return testApp
}

// ── authenticateApiKey + requireScope ──────────────────────────────────
describe('authenticateApiKey middleware', () => {
  it('returns 401 when no API key is provided', async () => {
    const testApp = buildApp(authenticateApiKey)
    const res = await request(testApp).get('/test')
    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/no api key/i)
  })

  it('returns 401 for an invalid API key', async () => {
    const testApp = buildApp(authenticateApiKey)
    const res = await request(testApp).get('/test').set('X-API-Key', 'sk_invalid')
    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/invalid or expired/i)
  })

  it('attaches req.user and req.apiKey on success', async () => {
    const { res: registerRes } = await registerUser('apikey-valid')
    const userId = registerRes.body.data.user.id
    const { apiKey, key } = await createApiKey(userId, {
      name: 'Test Key',
      scopes: ['read', 'write'],
    })
    createdKeyIds.push(apiKey.id)

    const testApp = buildApp(authenticateApiKey)
    const res = await request(testApp).get('/test').set('X-API-Key', key)
    expect(res.status).toBe(200)
    expect(res.body.apiKey.id).toBe(apiKey.id)
    expect(res.body.apiKey.scopes).toEqual(['read', 'write'])
    expect(res.body.user.id).toBe(userId)
  })
})

describe('requireScope middleware', () => {
  it('returns 401 when no API key context exists', async () => {
    const testApp = buildApp(requireScope('read'))
    const res = await request(testApp).get('/test')
    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/no api key context/i)
  })

  it('returns 403 when the scope is missing', async () => {
    const { res: registerRes } = await registerUser('apikey-scope-missing')
    const userId = registerRes.body.data.user.id
    const { apiKey, key } = await createApiKey(userId, { name: 'Read Only', scopes: ['read'] })
    createdKeyIds.push(apiKey.id)

    const testApp = buildApp(authenticateApiKey, requireScope('write'))
    const res = await request(testApp).get('/test').set('X-API-Key', key)
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/required scope/i)
  })

  it('passes when the scope is present', async () => {
    const { res: registerRes } = await registerUser('apikey-scope-ok')
    const userId = registerRes.body.data.user.id
    const { apiKey, key } = await createApiKey(userId, {
      name: 'Write Key',
      scopes: ['read', 'write'],
    })
    createdKeyIds.push(apiKey.id)

    const testApp = buildApp(authenticateApiKey, requireScope('write'))
    const res = await request(testApp).get('/test').set('X-API-Key', key)
    expect(res.status).toBe(200)
  })
})

// ── requireSubscription + requirePlan ────────────────────────────────
describe('requireSubscription middleware', () => {
  it('returns 401 when no user is attached', async () => {
    const testApp = buildApp(requireSubscription)
    const res = await request(testApp).get('/test')
    expect(res.status).toBe(401)
    expect(res.body.message).toMatch(/no token/i)
  })

  it('returns 402 when the user has no active subscription', async () => {
    const { res: registerRes } = await registerUser('no-sub')
    const userId = registerRes.body.data.user.id

    const testApp = buildApp((req, _res, next) => {
      req.user = { id: userId }
      next()
    }, requireSubscription)
    const res = await request(testApp).get('/test')
    expect(res.status).toBe(402)
    expect(res.body.message).toMatch(/active subscription required/i)
  })

  it('attaches req.subscription when an active subscription exists', async () => {
    const { res: registerRes } = await registerUser('with-sub')
    const userId = registerRes.body.data.user.id
    const sub = await prisma.subscription.create({
      data: {
        userId,
        planId: proPlan.id,
        stripeSubscriptionId: `sub_mw_${RUN_ID}`,
        stripeCustomerId: `cus_mw_${RUN_ID}`,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
    createdSubscriptionIds.push(sub.id)

    const testApp = buildApp((req, _res, next) => {
      req.user = { id: userId }
      next()
    }, requireSubscription)
    const res = await request(testApp).get('/test')
    expect(res.status).toBe(200)
    expect(res.body.subscription.status).toBe('ACTIVE')
    expect(res.body.subscription.plan.name).toBe(proPlan.name)
  })
})

describe('requirePlan middleware', () => {
  it('returns 402 when no subscription context exists', async () => {
    const testApp = buildApp(requirePlan('Pro'))
    const res = await request(testApp).get('/test')
    expect(res.status).toBe(402)
    expect(res.body.message).toMatch(/active subscription required/i)
  })

  it('returns 403 when the plan does not match', async () => {
    const { res: registerRes } = await registerUser('wrong-plan')
    const userId = registerRes.body.data.user.id
    const sub = await prisma.subscription.create({
      data: {
        userId,
        planId: freePlan.id,
        stripeSubscriptionId: `sub_mw_free_${RUN_ID}`,
        stripeCustomerId: `cus_mw_free_${RUN_ID}`,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
    createdSubscriptionIds.push(sub.id)

    const testApp = buildApp(
      (req, _res, next) => {
        req.user = { id: userId }
        next()
      },
      requireSubscription,
      requirePlan(proPlan.name),
    )
    const res = await request(testApp).get('/test')
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/requires one of/i)
  })

  it('passes when the plan matches', async () => {
    const { res: registerRes } = await registerUser('right-plan')
    const userId = registerRes.body.data.user.id
    const sub = await prisma.subscription.create({
      data: {
        userId,
        planId: proPlan.id,
        stripeSubscriptionId: `sub_mw_pro_${RUN_ID}`,
        stripeCustomerId: `cus_mw_pro_${RUN_ID}`,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
    createdSubscriptionIds.push(sub.id)

    const testApp = buildApp(
      (req, _res, next) => {
        req.user = { id: userId }
        next()
      },
      requireSubscription,
      requirePlan(proPlan.name),
    )
    const res = await request(testApp).get('/test')
    expect(res.status).toBe(200)
  })
})

// ── requireFeatureFlag ───────────────────────────────────────────────
describe('requireFeatureFlag middleware', () => {
  it('returns 403 when the flag is disabled', async () => {
    const flagKey = `mw_disabled_${RUN_ID}`
    await prisma.featureFlag.create({
      data: {
        key: flagKey,
        name: 'MW Disabled Flag',
        type: 'BOOLEAN',
        value: { enabled: false },
        active: true,
      },
    })
    createdFlagKeys.push(flagKey)

    const testApp = buildApp(requireFeatureFlag(flagKey))
    const res = await request(testApp).get('/test')
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/not enabled/i)
  })

  it('passes when the flag is enabled', async () => {
    const flagKey = `mw_enabled_${RUN_ID}`
    await prisma.featureFlag.create({
      data: {
        key: flagKey,
        name: 'MW Enabled Flag',
        type: 'BOOLEAN',
        value: { enabled: true },
        active: true,
      },
    })
    createdFlagKeys.push(flagKey)

    const testApp = buildApp(requireFeatureFlag(flagKey))
    const res = await request(testApp).get('/test')
    expect(res.status).toBe(200)
    expect(res.body.featureFlag.enabled).toBe(true)
  })

  it('returns 403 for an inactive flag', async () => {
    const flagKey = `mw_inactive_${RUN_ID}`
    await prisma.featureFlag.create({
      data: {
        key: flagKey,
        name: 'MW Inactive Flag',
        type: 'BOOLEAN',
        value: { enabled: true },
        active: false,
      },
    })
    createdFlagKeys.push(flagKey)

    const testApp = buildApp(requireFeatureFlag(flagKey))
    const res = await request(testApp).get('/test')
    expect(res.status).toBe(403)
  })
})
