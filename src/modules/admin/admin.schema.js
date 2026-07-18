import { z } from 'zod'

export const listUsersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().optional(),
    role: z.enum(['USER', 'ADMIN']).optional(),
    status: z.enum(['active', 'banned', 'suspended']).optional(),
    sort: z.enum(['createdAt', 'email', 'name']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  }),
})

export const userIdParamSchema = z.object({
  params: z.object({
    userId: z.string().min(1),
  }),
})

export const updateUserSchema = z.object({
  params: z.object({
    userId: z.string().min(1),
  }),
  body: z
    .object({
      name: z.string().min(1).max(100).optional(),
      role: z.enum(['USER', 'ADMIN']).optional(),
      banned: z.boolean().optional(),
      suspendedUntil: z
        .string()
        .datetime()
        .optional()
        .nullable()
        .transform((val) => (val === null ? null : val)),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided',
    }),
})
