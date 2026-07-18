import { prisma } from '../../config/db.js'
import { httpError } from '../../utils/httpError.js'
import { paginationParams, paginationMeta, parseSort, buildSearch } from '../../utils/query.js'

const orgSelect = {
  id: true,
  name: true,
  slug: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
}

const memberSelect = {
  id: true,
  role: true,
  createdAt: true,
  user: {
    select: { id: true, name: true, email: true },
  },
}

export const createOrganization = async (userId, { name, slug }) => {
  const existing = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (existing) throw httpError('Slug already taken', 409)

  const organization = await prisma.organization.create({
    data: {
      name: name.trim(),
      slug,
      ownerId: userId,
      members: {
        create: { userId, role: 'OWNER' },
      },
    },
    select: orgSelect,
  })

  return { organization }
}

export const listOrganizations = async (userId, query = {}) => {
  const { page, limit, search, sort, order } = query

  const where = { userId }

  const searchClause = buildSearch(search, ['organization.name', 'organization.slug'])
  if (searchClause) where.OR = searchClause

  const [memberships, total] = await Promise.all([
    prisma.organizationMember.findMany({
      where,
      select: {
        role: true,
        organization: { select: orgSelect },
      },
      orderBy: { organization: parseSort(sort, order, ['createdAt', 'name', 'slug']) },
      ...paginationParams(page ?? 1, limit ?? 20),
    }),
    prisma.organizationMember.count({ where }),
  ])

  return {
    organizations: memberships.map((m) => ({
      ...m.organization,
      role: m.role,
    })),
    pagination: paginationMeta(page ?? 1, limit ?? 20, total),
  }
}

export const getOrganization = async (orgId) => {
  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
    select: orgSelect,
  })
  if (!organization) throw httpError('Organization not found', 404)

  return { organization }
}

export const updateOrganization = async (orgId, { name, slug }) => {
  if (slug) {
    const existing = await prisma.organization.findUnique({
      where: { slug },
      select: { id: true },
    })
    if (existing && existing.id !== orgId) throw httpError('Slug already taken', 409)
  }

  const data = {}
  if (name !== undefined) data.name = name.trim()
  if (slug !== undefined) data.slug = slug

  const organization = await prisma.organization.update({
    where: { id: orgId },
    data,
    select: orgSelect,
  })

  return { organization }
}

export const deleteOrganization = async (orgId) => {
  await prisma.organization.delete({ where: { id: orgId } })
  return { message: 'Organization deleted successfully' }
}

export const listMembers = async (orgId, query = {}) => {
  const { page, limit, search, sort, order } = query

  const where = { organizationId: orgId }

  const searchClause = buildSearch(search, ['user.name', 'user.email'])
  if (searchClause) where.OR = searchClause

  const [members, total] = await Promise.all([
    prisma.organizationMember.findMany({
      where,
      select: memberSelect,
      orderBy: parseSort(sort, order, ['createdAt', 'role']),
      ...paginationParams(page ?? 1, limit ?? 20),
    }),
    prisma.organizationMember.count({ where }),
  ])

  return {
    members,
    pagination: paginationMeta(page ?? 1, limit ?? 20, total),
  }
}

export const updateMemberRole = async (orgId, targetUserId, role) => {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
    select: { id: true, role: true },
  })
  if (!membership) throw httpError('Member not found', 404)

  if (membership.role === 'OWNER') {
    throw httpError('Cannot change the role of the organization owner', 400)
  }

  const updated = await prisma.organizationMember.update({
    where: { id: membership.id },
    data: { role },
    select: memberSelect,
  })

  return { member: updated }
}

export const removeMember = async (orgId, targetUserId) => {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
    select: { id: true, role: true },
  })
  if (!membership) throw httpError('Member not found', 404)

  if (membership.role === 'OWNER') {
    throw httpError('Cannot remove the organization owner', 400)
  }

  await prisma.organizationMember.delete({ where: { id: membership.id } })
  return { message: 'Member removed successfully' }
}
