import { z } from 'zod'
import { listQuerySchema } from '../../utils/query.schema.js'

export const createInvitationSchema = z.object({
  params: z.object({
    orgId: z.string().min(1),
  }),
  body: z.object({
    email: z.string().email('Valid email is required'),
    role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
  }),
})

export const listInvitationsSchema = z.object({
  params: z.object({
    orgId: z.string().min(1),
  }),
  query: listQuerySchema(['createdAt', 'status', 'expiresAt'], {
    extra: {
      search: z.string().optional(),
    },
  }),
})

export const cancelInvitationSchema = z.object({
  params: z.object({
    orgId: z.string().min(1),
    invitationId: z.string().min(1),
  }),
})

export const acceptInvitationSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'Token is required'),
  }),
})

export const declineInvitationSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'Token is required'),
  }),
})

export const listMyInvitationsSchema = z.object({
  query: listQuerySchema(['createdAt', 'expiresAt'], {
    extra: {
      search: z.string().optional(),
    },
  }),
})
