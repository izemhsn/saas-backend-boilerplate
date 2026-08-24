import { prisma } from '../../config/db.js'
import { httpError } from '../../utils/httpError.js'
import { paginationParams, paginationMeta, parseSort, buildSearch } from '../../utils/query.js'

const projectSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true, email: true } },
}

const SORT_FIELDS = ['createdAt', 'updatedAt', 'name', 'status']

// Every lookup is scoped to organizationId as well as the project id. The tenant
// guard has already proven membership of that org, so scoping here is what turns
// a project id belonging to another tenant into a 404 rather than a disclosure.
// `deletedAt: null` is explicit — this codebase has no global soft-delete filter.
const findLive = async (organizationId, projectId) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId, deletedAt: null },
    select: projectSelect,
  })
  if (!project) throw httpError('errors.projectNotFound', 404)
  return project
}

export const listProjects = async (organizationId, query = {}) => {
  const { page, limit, sort, order, search, status } = query
  const { skip, take } = paginationParams(page, limit)

  const where = {
    organizationId,
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(search ? { OR: buildSearch(search, ['name', 'description']) } : {}),
  }

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      select: projectSelect,
      orderBy: parseSort(sort, order, SORT_FIELDS),
      skip,
      take,
    }),
    prisma.project.count({ where }),
  ])

  return { projects, meta: paginationMeta(page, limit, total) }
}

export const getProject = async (organizationId, projectId) => {
  const project = await findLive(organizationId, projectId)
  return { project }
}

export const createProject = async (organizationId, userId, { name, description }) => {
  const project = await prisma.project.create({
    data: {
      organizationId,
      createdById: userId,
      name: name.trim(),
      description: description?.trim() ?? null,
    },
    select: projectSelect,
  })

  return { project, messageKey: 'messages.projectCreated' }
}

export const updateProject = async (organizationId, projectId, body) => {
  await findLive(organizationId, projectId)

  const data = {}
  if (body.name !== undefined) data.name = body.name.trim()
  if (body.description !== undefined) data.description = body.description?.trim() ?? null
  if (body.status !== undefined) data.status = body.status

  const project = await prisma.project.update({
    where: { id: projectId },
    data,
    select: projectSelect,
  })

  return { project, messageKey: 'messages.projectUpdated' }
}

export const deleteProject = async (organizationId, projectId) => {
  await findLive(organizationId, projectId)

  // Soft delete, consistent with User/Organization/ApiKey.
  await prisma.project.update({
    where: { id: projectId },
    data: { deletedAt: new Date() },
  })

  return { messageKey: 'messages.projectDeleted' }
}

// The "premium" action behind requirePlan + requireFeatureFlag. Returns the
// whole live set for the org rather than a page — the point of the example is
// the guard chain in the router, not the payload.
export const exportProjects = async (organizationId) => {
  const projects = await prisma.project.findMany({
    where: { organizationId, deletedAt: null },
    select: projectSelect,
    orderBy: { createdAt: 'desc' },
  })

  return { projects, exportedAt: new Date().toISOString(), messageKey: 'messages.projectsExported' }
}
