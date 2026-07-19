import { z } from 'zod'
import { listQuerySchema } from '../../utils/query.schema.js'

export const createApiKeySchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required').max(100),
    scopes: z.array(z.string()).default([]),
    expiresAt: z.string().datetime().optional().nullable(),
  }),
})

export const keyIdParamSchema = z.object({
  params: z.object({
    keyId: z.string().min(1),
  }),
})

export const listApiKeysSchema = z.object({
  query: listQuerySchema(['createdAt', 'name', 'lastUsedAt'], {
    extra: {
      search: z.string().optional(),
    },
  }),
})
