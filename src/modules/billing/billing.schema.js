import { z } from 'zod'
import { listQuerySchema } from '../../utils/query.schema.js'

export const checkoutSchema = z.object({
  body: z.object({
    planId: z.string().min(1, 'validation.planIdRequired'),
    successUrl: z.string().url('validation.validUrl'),
    cancelUrl: z.string().url('validation.validUrl'),
  }),
})

export const portalSchema = z.object({
  body: z.object({
    returnUrl: z.string().url('validation.validUrl'),
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
