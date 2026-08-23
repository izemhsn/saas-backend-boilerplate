import 'dotenv/config'
import { describe, it, expect, afterAll, vi } from 'vitest'
import request from 'supertest'
import { prisma } from '../src/config/db.js'

// Stripe env must be set BEFORE app (and src/config/stripe.js) is imported,
// so this file uses a dynamic import instead of a static one — same pattern
// as tests/billing.webhook.test.js. `dotenv/config` is imported explicitly
// (see that file's comment) because the static config/db.js import below is
// hoisted ahead of the dynamic app.js import that would otherwise load it.
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'

const mockCancel = vi.fn()

// Mock the Stripe SDK itself so account deletion never makes a real network
// call — only stripe.subscriptions.cancel is exercised by H7.
vi.mock('stripe', () => {
  return {
    default: class Stripe {
      subscriptions = { cancel: (...args) => mockCancel(...args) }
    },
  }
})

const { default: app } = await import('../src/app.js')

const RUN_ID = Date.now()
const emailFor = (label) => `test-gdpr-stripe-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdUserIds = []
const createdPlanIds = []

async function registerUser(label) {
  const email = emailFor(label)
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: `Test ${label}`, email, password: VALID_PASSWORD })
  createdUserIds.push(res.body.data.user.id)
  return { email, userId: res.body.data.user.id, token: res.body.data.token }
}

let subscriptionCounter = 0

async function createLiveSubscription(userId, status = 'ACTIVE') {
  const unique = `${RUN_ID}_${status}_${subscriptionCounter++}`
  const plan = await prisma.plan.create({
    data: {
      name: `Stripe Cancel Test Plan ${unique}`,
      stripePriceId: `price_stripe_cancel_${unique}`,
      priceCents: 999,
      interval: 'MONTH',
    },
  })
  createdPlanIds.push(plan.id)

  const stripeSubscriptionId = `sub_cancel_test_${unique}`
  await prisma.subscription.create({
    data: {
      userId,
      planId: plan.id,
      stripeSubscriptionId,
      stripeCustomerId: `cus_${RUN_ID}`,
      status,
    },
  })
  return stripeSubscriptionId
}

afterAll(async () => {
  await prisma.subscription.deleteMany({ where: { userId: { in: createdUserIds } } })
  await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } })
  await prisma.refreshToken.deleteMany({ where: { userId: { in: createdUserIds } } })
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
  await prisma.$disconnect()
})

// H7 — deleteAccount hard-deletes the local Subscription rows (cascade), but
// without an explicit cancellation the Stripe subscription itself keeps
// running and the customer keeps being charged for a service that no longer
// has any local record of them.
describe('DELETE /api/auth/account — Stripe subscription cancellation (H7)', () => {
  it('cancels every live Stripe subscription before deleting the account', async () => {
    mockCancel.mockReset().mockResolvedValue({})
    const { token, userId } = await registerUser('cancel-success')
    const activeSubId = await createLiveSubscription(userId, 'ACTIVE')
    const trialSubId = await createLiveSubscription(userId, 'TRIALING')
    // A CANCELED subscription is not "live" and must not trigger a call
    const canceledSubId = await createLiveSubscription(userId, 'CANCELED')

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: VALID_PASSWORD })

    expect(res.status).toBe(200)
    expect(mockCancel).toHaveBeenCalledWith(activeSubId)
    expect(mockCancel).toHaveBeenCalledWith(trialSubId)
    expect(mockCancel).not.toHaveBeenCalledWith(canceledSubId)

    const dbUser = await prisma.user.findUnique({ where: { id: userId } })
    expect(dbUser).toBeNull()
    createdUserIds.splice(createdUserIds.indexOf(userId), 1)
  })

  it('fails the deletion (and keeps the account) when Stripe cancellation fails', async () => {
    mockCancel.mockReset().mockRejectedValue(new Error('Stripe is down'))
    const { token, userId } = await registerUser('cancel-failure')
    await createLiveSubscription(userId, 'ACTIVE')

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: VALID_PASSWORD })

    expect(res.status).toBe(502)

    // The account must still exist — deleting it while Stripe still thinks
    // the subscription is live would leave a billed customer with no local
    // record to reconcile against.
    const dbUser = await prisma.user.findUnique({ where: { id: userId } })
    expect(dbUser).not.toBeNull()
  })
})
