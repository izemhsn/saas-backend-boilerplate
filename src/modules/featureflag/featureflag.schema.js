import { z } from 'zod'
import { listQuerySchema } from '../../utils/query.schema.js'

export const createFlagSchema = z.object({
  body: z
    .object({
      key: z
        .string()
        .min(2, 'validation.keyMinLength')
        .max(100)
        .regex(/^[a-z0-9](?:[a-z0-9_:.-]*[a-z0-9])?$/, 'validation.keyFormat'),
      name: z.string().min(2, 'validation.nameMinLength').max(200),
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
          message: 'validation.booleanFlagFormat',
        })
      }
      if (data.type === 'PERCENTAGE') {
        const pct = data.value?.percentage
        if (pct !== undefined && (typeof pct !== 'number' || pct < 0 || pct > 100)) {
          ctx.addIssue({
            path: ['body', 'value'],
            message: 'validation.percentageFlagFormat',
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
            message: 'validation.planFlagFormat',
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
      message: 'validation.atLeastOneField',
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
    key: z.string().min(1, 'validation.flagKeyRequired'),
    orgId: z.string().optional(),
  }),
})
