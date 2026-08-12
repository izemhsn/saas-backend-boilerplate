import { z } from 'zod'
import { listQuerySchema } from '../../utils/query.schema.js'

// Must stay in sync with the AuditAction enum in prisma/schema.prisma
const auditActions = [
  'USER_REGISTER',
  'USER_LOGIN',
  'USER_OAUTH_LOGIN',
  'USER_LOGOUT',
  'USER_LOGIN_FAILED',
  'USER_BANNED',
  'USER_UNBANNED',
  'USER_SUSPENDED',
  'USER_UNSUSPENDED',
  'USER_ROLE_CHANGED',
  'USER_DELETED',
  'USER_RESTORED',
  'USER_PASSWORD_CHANGED',
  'USER_EMAIL_CHANGED',
  'ORG_CREATED',
  'ORG_UPDATED',
  'ORG_DELETED',
  'ORG_RESTORED',
  'MEMBER_ADDED',
  'MEMBER_REMOVED',
  'MEMBER_ROLE_CHANGED',
  'MEMBER_INVITED',
  'INVITATION_ACCEPTED',
  'INVITATION_DECLINED',
  'INVITATION_CANCELED',
  'API_KEY_CREATED',
  'API_KEY_REVOKED',
  'API_KEY_DELETED',
  'SUBSCRIPTION_CREATED',
  'SUBSCRIPTION_UPDATED',
  'SUBSCRIPTION_CANCELED',
  'CHECKOUT_STARTED',
  'PORTAL_OPENED',
  'FEATURE_FLAG_CREATED',
  'FEATURE_FLAG_UPDATED',
  'FEATURE_FLAG_DELETED',
  'FEATURE_FLAG_OVERRIDE_SET',
  'FEATURE_FLAG_OVERRIDE_REMOVED',
  'USER_DATA_EXPORTED',
  'USER_DATA_DELETED',
  'TWO_FACTOR_ENABLED',
  'TWO_FACTOR_DISABLED',
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
