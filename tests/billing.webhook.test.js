import 'dotenv/config'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import Stripe from 'stripe'
import { prisma } from '../src/config/db.js'

// Stripe env must be set BEFORE app (and src/config/stripe.js) is imported,
// so this file uses a dynamic import instead of a static one. `dotenv/config`
// is imported explicitly above (rather than relying on it as a side effect
// of importing app.js, as most test files do) because the static
// `config/db.js` import below is hoisted ahead of everything else in this
// file — without this, its pg.Pool would be constructed before DATABASE_URL
// is loaded from .env.
const WEBHOOK_SECRET = 'whsec_test_secret'
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET

const { default: app } = await import('../src/app.js')

const stripe = new Stripe('sk_test_dummy')

const RUN_ID = Date.now()

// Audit logging is fire-and-forget (see audit.service.js's `log()`) — it
// isn't awaited by the request that triggers it, so a check against the
// audit_logs table right after a response comes back can race the write.
// Same pattern as tests/audit.test.js.
const flushAuditLogs = () => new Promise((resolve) => setTimeout(resolve, 300))

const sendEvent = async (event) => {
  const payload = JSON.stringify(event)
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })
  return request(app)
    .post('/api/billing/webhook')
    .set('Stripe-Signature', signature)
    .set('Content-Type', 'application/json')
    .send(payload)
}

// A minimal customer.subscription.updated event. `created` and `status` are
// the two fields the H5 tests below vary.
const subscriptionEvent = ({ eventId, created, status, stripeSubscriptionId, userId, planId }) => ({
  id: eventId,
  object: 'event',
  type: 'customer.subscription.updated',
  created,
  data: {
    object: {
      id: stripeSubscriptionId,
      customer: `cus_${RUN_ID}`,
      status,
      trial_end: null,
      canceled_at: null,
      current_period_start: created,
      current_period_end: created + 30 * 24 * 60 * 60,
      metadata: { userId, planId },
    },
  },
})

describe('POST /api/billing/webhook (signature verification)', () => {
  it('accepts a correctly signed event (raw body must reach constructEvent)', async () => {
    const payload = JSON.stringify({
      id: 'evt_test_webhook',
      object: 'event',
      type: 'test.unhandled_event',
      data: { object: {} },
    })

    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    })

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Stripe-Signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.received).toBe(true)
    expect(res.body.data.type).toBe('test.unhandled_event')
  })

  it('rejects an event with an invalid signature', async () => {
    const payload = JSON.stringify({ type: 'test.unhandled_event' })

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Stripe-Signature', 't=123,v1=invalid_signature')
      .set('Content-Type', 'application/json')
      .send(payload)

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/signature verification failed/i)
  })

  // G2 — request-ID middleware runs before the webhook route, so webhook
  // requests get an X-Request-Id header (and appear in the access log)
  it('attaches an X-Request-Id header to webhook responses', async () => {
    const payload = JSON.stringify({ type: 'test.unhandled_event' })

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Stripe-Signature', 't=123,v1=invalid_signature')
      .set('Content-Type', 'application/json')
      .send(payload)

    expect(res.headers['x-request-id']).toBeTypeOf('string')
    expect(res.headers['x-request-id'].length).toBeGreaterThan(0)
  })

  it('echoes a valid client-supplied X-Request-Id on webhook responses', async () => {
    const payload = JSON.stringify({ type: 'test.unhandled_event' })

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Stripe-Signature', 't=123,v1=invalid_signature')
      .set('Content-Type', 'application/json')
      .set('X-Request-Id', 'stripe-evt-trace-123')
      .send(payload)

    expect(res.headers['x-request-id']).toBe('stripe-evt-trace-123')
  })
})

// H5 — Stripe delivery is at-least-once (retries/resends can duplicate an
// event) and unordered (events can arrive out of sequence).
describe('POST /api/billing/webhook (idempotency + ordering — H5)', () => {
  let userId
  let planId

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `webhook-h5-${RUN_ID}@example.com`, name: 'Webhook Test' },
    })
    userId = user.id

    const plan = await prisma.plan.create({
      data: {
        name: `Webhook Test Plan ${RUN_ID}`,
        code: `webhook-h5-${RUN_ID}`,
        stripePriceId: `price_webhook_h5_${RUN_ID}`,
        priceCents: 999,
        interval: 'MONTH',
      },
    })
    planId = plan.id
  })

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { userId } })
    await prisma.plan.delete({ where: { id: planId } })
    await prisma.user.delete({ where: { id: userId } })
  })

  it('processes a subscription.updated event exactly once, even when redelivered', async () => {
    const stripeSubscriptionId = `sub_idempotent_${RUN_ID}`
    const event = subscriptionEvent({
      eventId: `evt_idempotent_${RUN_ID}`,
      created: 1_800_000_000,
      status: 'active',
      stripeSubscriptionId,
      userId,
      planId,
    })

    const first = await sendEvent(event)
    expect(first.status).toBe(200)

    // Exact same event, redelivered (Stripe's own retry/resend behavior)
    const second = await sendEvent(event)
    expect(second.status).toBe(200)
    await flushAuditLogs()

    const sub = await prisma.subscription.findUnique({ where: { stripeSubscriptionId } })
    expect(sub.status).toBe('ACTIVE')

    // The redelivery must never have reached upsertSubscription a second
    // time — proven by there being no second write logged for it.
    const updateLogs = await prisma.auditLog.count({
      where: {
        action: 'SUBSCRIPTION_UPDATED',
        metadata: { path: ['stripeSubscriptionId'], equals: stripeSubscriptionId },
      },
    })
    expect(updateLogs).toBe(0)

    const createLogs = await prisma.auditLog.count({
      where: {
        action: 'SUBSCRIPTION_CREATED',
        metadata: { path: ['stripeSubscriptionId'], equals: stripeSubscriptionId },
      },
    })
    expect(createLogs).toBe(1)
  })

  it('does not let an out-of-order (older) event overwrite newer state', async () => {
    const stripeSubscriptionId = `sub_ordering_${RUN_ID}`

    // Newer event arrives first: ACTIVE
    const newer = await sendEvent(
      subscriptionEvent({
        eventId: `evt_ordering_newer_${RUN_ID}`,
        created: 1_800_001_000,
        status: 'active',
        stripeSubscriptionId,
        userId,
        planId,
      }),
    )
    expect(newer.status).toBe(200)

    // Older (stale) event arrives after it: CANCELED — must be ignored
    const older = await sendEvent(
      subscriptionEvent({
        eventId: `evt_ordering_older_${RUN_ID}`,
        created: 1_800_000_500,
        status: 'canceled',
        stripeSubscriptionId,
        userId,
        planId,
      }),
    )
    expect(older.status).toBe(200) // still 200 — Stripe must not be told to retry

    const afterStale = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId },
    })
    expect(afterStale.status).toBe('ACTIVE')

    // A genuinely newer event still applies normally
    const evenNewer = await sendEvent(
      subscriptionEvent({
        eventId: `evt_ordering_newest_${RUN_ID}`,
        created: 1_800_002_000,
        status: 'canceled',
        stripeSubscriptionId,
        userId,
        planId,
      }),
    )
    expect(evenNewer.status).toBe(200)

    const final = await prisma.subscription.findUnique({ where: { stripeSubscriptionId } })
    expect(final.status).toBe('CANCELED')
  })
})

// M12 — the same webhook handler must also create/update subscriptions scoped
// to an organizationId instead of a userId, since org-scoped checkout sets
// only `organizationId` in Stripe metadata (never both — see billing.service.js).
describe('POST /api/billing/webhook (org-scoped subscriptions — M12)', () => {
  let organizationId
  let ownerId
  let planId

  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: { email: `webhook-org-owner-${RUN_ID}@example.com`, name: 'Webhook Org Owner' },
    })
    ownerId = owner.id

    const org = await prisma.organization.create({
      data: { name: 'Webhook Org', slug: `webhook-org-${RUN_ID}`, ownerId },
    })
    organizationId = org.id

    const plan = await prisma.plan.create({
      data: {
        name: `Webhook Org Test Plan ${RUN_ID}`,
        code: `webhook-org-${RUN_ID}`,
        stripePriceId: `price_webhook_org_${RUN_ID}`,
        priceCents: 999,
        interval: 'MONTH',
      },
    })
    planId = plan.id
  })

  afterAll(async () => {
    await prisma.subscription.deleteMany({ where: { organizationId } })
    await prisma.plan.delete({ where: { id: planId } })
    await prisma.organization.delete({ where: { id: organizationId } })
    await prisma.user.delete({ where: { id: ownerId } })
  })

  const orgSubscriptionEvent = ({ eventId, created, status, stripeSubscriptionId }) => ({
    id: eventId,
    object: 'event',
    type: 'customer.subscription.updated',
    created,
    data: {
      object: {
        id: stripeSubscriptionId,
        customer: `cus_org_${RUN_ID}`,
        status,
        trial_end: null,
        canceled_at: null,
        current_period_start: created,
        current_period_end: created + 30 * 24 * 60 * 60,
        // No userId — organizationId alone identifies the owner.
        metadata: { organizationId, planId },
      },
    },
  })

  it('creates a Subscription scoped to organizationId, with userId left null', async () => {
    const stripeSubscriptionId = `sub_org_webhook_${RUN_ID}`

    const res = await sendEvent(
      orgSubscriptionEvent({
        eventId: `evt_org_webhook_${RUN_ID}`,
        created: 1_800_000_000,
        status: 'active',
        stripeSubscriptionId,
      }),
    )
    expect(res.status).toBe(200)

    const sub = await prisma.subscription.findUnique({ where: { stripeSubscriptionId } })
    expect(sub.status).toBe('ACTIVE')
    expect(sub.organizationId).toBe(organizationId)
    expect(sub.userId).toBeNull()
  })
})
