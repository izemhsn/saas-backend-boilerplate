import { z } from 'zod'
import { listQuerySchema } from '../../utils/query.schema.js'

// L5: successUrl/cancelUrl/returnUrl are client-supplied and passed straight
// through to Stripe as success_url/cancel_url/return_url
// (billing.service.js) — Stripe faithfully redirects the user's browser
// there once checkout/the billing portal completes, so with no origin check
// this is a Stripe-hosted open redirect. Restricted to APP_URL's origin, the
// same origin already used for every other user-facing link this app
// generates (email verification, password reset, invitation accept — see
// email.service.js). Read at validation time (not schema-definition time)
// so it reflects the current env, including in tests that override it.
const isAppOrigin = (url) => {
  try {
    return new URL(url).origin === new URL(process.env.APP_URL || 'http://localhost:3000').origin
  } catch {
    return false
  }
}

const redirectUrl = () =>
  z.string().url('validation.validUrl').refine(isAppOrigin, 'validation.urlOriginNotAllowed')

export const checkoutSchema = z.object({
  body: z.object({
    planId: z.string().min(1, 'validation.planIdRequired'),
    successUrl: redirectUrl(),
    cancelUrl: redirectUrl(),
  }),
})

export const portalSchema = z.object({
  body: z.object({
    returnUrl: redirectUrl(),
  }),
})

export const listPlansSchema = z.object({
  query: listQuerySchema(['createdAt', 'name', 'priceCents'], {
    defaultSort: 'priceCents',
    extra: {
      interval: z.enum(['MONTH', 'YEAR']).optional(),
    },
  }),
})
