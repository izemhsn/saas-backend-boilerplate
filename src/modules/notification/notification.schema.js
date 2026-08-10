import { z } from 'zod'
import { listQuerySchema } from '../../utils/query.schema.js'

export const listNotificationsSchema = z.object({
  query: listQuerySchema(['createdAt', 'type', 'readAt'], {
    extra: {
      search: z.string().optional(),
      type: z.enum(['SYSTEM', 'ORGANIZATION', 'BILLING', 'SECURITY', 'TEAM']).optional(),
      unreadOnly: z.enum(['true', 'false']).optional(),
    },
  }),
})

export const notificationIdSchema = z.object({
  params: z.object({
    notificationId: z.string().min(1),
  }),
})

export const updatePreferencesSchema = z.object({
  body: z
    .object({
      emailEnabled: z.boolean().optional(),
      pushEnabled: z.boolean().optional(),
      inAppEnabled: z.boolean().optional(),
      mutedTypes: z
        .array(z.enum(['SYSTEM', 'ORGANIZATION', 'BILLING', 'SECURITY', 'TEAM']))
        .optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'validation.atLeastOnePreferenceField',
    }),
})
