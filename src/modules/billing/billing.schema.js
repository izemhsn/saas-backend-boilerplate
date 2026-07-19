import { z } from 'zod'
import { listQuerySchema } from '../../utils/query.schema.js'

export const checkoutSchema = z.object({
  body: z.object({
    planId: z.string().min(1, 'Plan ID is required'),
    successUrl: z.string().url('Must be a valid URL'),
    cancelUrl: z.string().url('Must be a valid URL'),
  }),
})

export const portalSchema = z.object({
  body: z.object({
    returnUrl: z.string().url('Must be a valid URL'),
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
