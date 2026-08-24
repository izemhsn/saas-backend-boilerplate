import { z } from 'zod'
import { listQuerySchema } from '../../utils/query.schema.js'

// Every project route is nested under /api/organizations/:orgId/projects, so
// `orgId` is present on all of them — `requireTenant` reads it from req.params.
const orgParams = { orgId: z.string().min(1) }

export const listProjectsSchema = z.object({
  params: z.object(orgParams),
  query: listQuerySchema(['createdAt', 'updatedAt', 'name', 'status'], {
    extra: {
      search: z.string().optional(),
      status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
    },
  }),
})

export const projectIdSchema = z.object({
  params: z.object({ ...orgParams, projectId: z.string().min(1) }),
})

export const createProjectSchema = z.object({
  params: z.object(orgParams),
  body: z.object({
    name: z.string().min(1, 'validation.projectNameRequired').max(120),
    description: z.string().max(2000).optional(),
  }),
})

export const updateProjectSchema = z.object({
  params: z.object({ ...orgParams, projectId: z.string().min(1) }),
  body: z
    .object({
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(2000).nullable().optional(),
      status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'validation.atLeastOneProjectField',
    }),
})
