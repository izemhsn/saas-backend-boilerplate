import { z } from 'zod'
import { listQuerySchema } from '../../utils/query.schema.js'

export const listSessionsSchema = z.object({
  query: listQuerySchema(['createdAt', 'updatedAt', 'expiresAt']),
})

export const sessionIdParamSchema = z.object({
  params: z.object({
    sessionId: z.string().min(1),
  }),
})
