import { z } from 'zod'

export const listQuerySchema = (allowedFields, { defaultSort = 'createdAt', extra = {} } = {}) =>
  z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(allowedFields).default(defaultSort),
    order: z.enum(['asc', 'desc']).default('desc'),
    ...extra,
  })
