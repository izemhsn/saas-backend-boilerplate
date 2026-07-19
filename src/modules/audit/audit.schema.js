import { z } from 'zod'
import { listQuerySchema } from '../../utils/query.schema.js'

const auditActions = [
  'USER_REGISTER',
  'USER_LOGIN',
  'USER_LOGOUT',
  'USER_LOGIN_FAILED',
  'USER_BANNED',
  'USER_UNBANNED',
  'USER_SUSPENDED',
  'USER_UNSUSPENDED',
  'USER_ROLE_CHANGED',
  'USER_DELETED',
  'USER_PASSWORD_CHANGED',
  'USER_EMAIL_CHANGED',
  'ORG_CREATED',
  'ORG_UPDATED',
  'ORG_DELETED',
  'MEMBER_ADDED',
  'MEMBER_REMOVED',
  'MEMBER_ROLE_CHANGED',
  'API_KEY_CREATED',
  'API_KEY_REVOKED',
  'API_KEY_DELETED',
  'SUBSCRIPTION_CREATED',
  'SUBSCRIPTION_UPDATED',
  'SUBSCRIPTION_CANCELED',
  'CHECKOUT_STARTED',
  'PORTAL_OPENED',
]

export const listAuditLogsSchema = z.object({
  query: listQuerySchema(['createdAt', 'action'], {
    extra: {
      action: z.enum(auditActions).optional(),
      userId: z.string().optional(),
      targetUserId: z.string().optional(),
      organizationId: z.string().optional(),
    },
  }),
})

export const listUserAuditLogsSchema = z.object({
  query: listQuerySchema(['createdAt', 'action']),
})
