import { z } from 'zod'

export const createOrgSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Organization name must be at least 2 characters').max(100),
    slug: z
      .string()
      .min(2, 'Slug must be at least 2 characters')
      .max(50)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Slug must be lowercase alphanumeric with hyphens'),
  }),
})

export const updateOrgSchema = z.object({
  params: z.object({
    orgId: z.string().min(1),
  }),
  body: z
    .object({
      name: z.string().min(2, 'Organization name must be at least 2 characters').max(100).optional(),
      slug: z
        .string()
        .min(2)
        .max(50)
        .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Slug must be lowercase alphanumeric with hyphens')
        .optional(),
    })
    .refine((data) => data.name !== undefined || data.slug !== undefined, {
      message: 'At least one field (name or slug) must be provided',
    }),
})

export const orgIdParamSchema = z.object({
  params: z.object({
    orgId: z.string().min(1),
  }),
})

export const updateMemberSchema = z.object({
  params: z.object({
    orgId: z.string().min(1),
    userId: z.string().min(1),
  }),
  body: z.object({
    role: z.enum(['ADMIN', 'MEMBER']),
  }),
})

export const removeMemberSchema = z.object({
  params: z.object({
    orgId: z.string().min(1),
    userId: z.string().min(1),
  }),
})
