import { describe, it, expect } from 'vitest'
import request from 'supertest'
import Stripe from 'stripe'

// Stripe env must be set BEFORE app (and src/config/stripe.js) is imported,
// so this file uses a dynamic import instead of a static one.
const WEBHOOK_SECRET = 'whsec_test_secret'
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET

const { default: app } = await import('../src/app.js')

const stripe = new Stripe('sk_test_dummy')

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
