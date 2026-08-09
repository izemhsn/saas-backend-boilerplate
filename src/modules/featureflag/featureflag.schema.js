import { z } from 'zod'
import { listQuerySchema } from '../../utils/query.schema.js'

export const createFlagSchema = z.object({
  body: z
    .object({
      key: z
        .string()
        .min(2, 'Key must be at least 2 characters')
        .max(100)
        .regex(
          /^[a-z0-9](?:[a-z0-9_:.-]*[a-z0-9])?$/,
          'Key must be lowercase alphanumeric with hyphens, dots, colons, or underscores',
        ),
      name: z.string().min(2, 'Name must be at least 2 characters').max(200),
      description: z.string().max(1000).optional(),
      type: z.enum(['BOOLEAN', 'PERCENTAGE', 'PLAN']),
      value: z.any().default({}),
      active: z.boolean().default(true),
    })
    .superRefine((data, ctx) => {
      if (
        data.type === 'BOOLEAN' &&
        typeof data.value?.enabled !== 'boolean' &&
        Object.keys(data.value).length > 0
      ) {
        ctx.addIssue({
          path: ['body', 'value'],
          message: 'BOOLEAN flags use { enabled: true/false }',
        })
      }
      if (data.type === 'PERCENTAGE') {
        const pct = data.value?.percentage
        if (pct !== undefined && (typeof pct !== 'number' || pct < 0 || pct > 100)) {
          ctx.addIssue({
            path: ['body', 'value'],
            message: 'PERCENTAGE flags use { percentage: 0-100 }',
          })
        }
      }
      if (data.type === 'PLAN' && data.value?.plans !== undefined) {
        if (
          !Array.isArray(data.value.plans) ||
          !data.value.plans.every((p) => typeof p === 'string')
        ) {
          ctx.addIssue({
            path: ['body', 'value'],
            message: 'PLAN flags use { plans: ["Free", "Pro"] }',
          })
        }
      }
    }),
})

export const updateFlagSchema = z.object({
  params: z.object({
    flagId: z.string().min(1),
  }),
  body: z
    .object({
      name: z.string().min(2).max(200).optional(),
      description: z.string().max(1000).optional(),
      type: z.enum(['BOOLEAN', 'PERCENTAGE', 'PLAN']).optional(),
      value: z.any().optional(),
      active: z.boolean().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided',
    }),
})

export const flagIdParamSchema = z.object({
  params: z.object({
    flagId: z.string().min(1),
  }),
})

export const listFlagsSchema = z.object({
  query: listQuerySchema(['createdAt', 'name', 'key', 'type'], {
    defaultSort: 'createdAt',
    extra: {
      search: z.string().optional(),
      type: z.enum(['BOOLEAN', 'PERCENTAGE', 'PLAN']).optional(),
      active: z.enum(['true', 'false']).optional(),
    },
  }),
})

export const setOverrideSchema = z.object({
  params: z.object({
    flagId: z.string().min(1),
    orgId: z.string().min(1),
  }),
  body: z.object({
    enabled: z.boolean().default(true),
    value: z.any().default({}),
  }),
})

export const overrideParamSchema = z.object({
  params: z.object({
    flagId: z.string().min(1),
    orgId: z.string().min(1),
  }),
})

export const evaluateFlagSchema = z.object({
  query: z.object({
    key: z.string().min(1, 'Flag key is required'),
    orgId: z.string().optional(),
  }),
})
