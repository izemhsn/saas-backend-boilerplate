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
const createdOrgIds = []

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
      code: `stripe-cancel-${unique}`,
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

// Org-scoped counterpart of createLiveSubscription: the subscription attaches
// to the organization, not the user (M12 — Subscription enforces exactly one
// of userId/organizationId via a CHECK constraint).
async function createLiveOrgSubscription(organizationId, status = 'ACTIVE') {
  const unique = `${RUN_ID}_org_${status}_${subscriptionCounter++}`
  const plan = await prisma.plan.create({
    data: {
      name: `Stripe Cancel Org Plan ${unique}`,
      code: `stripe-cancel-org-${unique}`,
      stripePriceId: `price_stripe_cancel_org_${unique}`,
      priceCents: 4900,
      interval: 'MONTH',
    },
  })
  createdPlanIds.push(plan.id)

  const stripeSubscriptionId = `sub_cancel_org_test_${unique}`
  await prisma.subscription.create({
    data: {
      organizationId,
      planId: plan.id,
      stripeSubscriptionId,
      stripeCustomerId: `cus_org_${RUN_ID}`,
      status,
    },
  })
  return stripeSubscriptionId
}

async function createOrg(label, token) {
  const res = await request(app)
    .post('/api/organizations')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `Org ${label} ${RUN_ID}`, slug: `stripe-cancel-${label}-${RUN_ID}` })
  createdOrgIds.push(res.body.data.organization.id)
  return res.body.data.organization
}

afterAll(async () => {
  await prisma.subscription.deleteMany({ where: { organizationId: { in: createdOrgIds } } })
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } })
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

// The same exposure as H7 above, one level out. Organization.owner and
// Subscription.organization are both onDelete: Cascade, so deleting a user
// destroys the organizations they solely own *and* those organizations'
// subscription rows — while Stripe carries on billing. The original fix
// scoped its cancellation query to `userId` alone and so missed this path
// entirely once org-scoped billing (M12) existed.
describe('DELETE /api/auth/account — org-owned Stripe subscriptions', () => {
  it("cancels a solo-owned organization's subscription before deleting the account", async () => {
    mockCancel.mockReset().mockResolvedValue({})
    const { token, userId } = await registerUser('org-cascade')
    const org = await createOrg('cascade', token)
    const orgSubId = await createLiveOrgSubscription(org.id, 'ACTIVE')

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: VALID_PASSWORD })

    expect(res.status).toBe(200)
    expect(mockCancel).toHaveBeenCalledWith(orgSubId)

    // The org (and its subscription row) cascaded away with the user — which
    // is exactly why the cancellation above had to happen first.
    const dbOrg = await prisma.organization.findUnique({ where: { id: org.id } })
    expect(dbOrg).toBeNull()
    createdUserIds.splice(createdUserIds.indexOf(userId), 1)
  })
})

// Soft-deleting an organization hides it from every API surface (requireTenant
// rejects deleted orgs), so leaving its subscription live would bill a
// customer for something they can no longer see, use, or cancel.
describe('DELETE /api/organizations/:orgId — Stripe subscription cancellation', () => {
  it("cancels the organization's live subscription before soft-deleting it", async () => {
    mockCancel.mockReset().mockResolvedValue({})
    const { token } = await registerUser('org-delete')
    const org = await createOrg('delete', token)
    const activeSubId = await createLiveOrgSubscription(org.id, 'ACTIVE')
    const canceledSubId = await createLiveOrgSubscription(org.id, 'CANCELED')

    const res = await request(app)
      .delete(`/api/organizations/${org.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(mockCancel).toHaveBeenCalledWith(activeSubId)
    expect(mockCancel).not.toHaveBeenCalledWith(canceledSubId)

    const dbOrg = await prisma.organization.findUnique({ where: { id: org.id } })
    expect(dbOrg.deletedAt).not.toBeNull()

    const dbSub = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: activeSubId },
    })
    expect(dbSub.status).toBe('CANCELED')
    expect(dbSub.canceledAt).not.toBeNull()
  })

  it('keeps the organization when Stripe cancellation fails', async () => {
    mockCancel.mockReset().mockRejectedValue(new Error('Stripe is down'))
    const { token } = await registerUser('org-delete-failure')
    const org = await createOrg('delete-fail', token)
    await createLiveOrgSubscription(org.id, 'ACTIVE')

    const res = await request(app)
      .delete(`/api/organizations/${org.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(502)

    const dbOrg = await prisma.organization.findUnique({ where: { id: org.id } })
    expect(dbOrg.deletedAt).toBeNull()
  })
})
