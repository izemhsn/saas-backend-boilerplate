import { prisma } from '../../config/db.js'
import { httpError } from '../../utils/httpError.js'

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

export const listOrganizations = async (userId) => {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId },
    select: {
      role: true,
      organization: { select: orgSelect },
    },
    orderBy: { organization: { createdAt: 'asc' } },
  })

  return {
    organizations: memberships.map((m) => ({
      ...m.organization,
      role: m.role,
    })),
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

export const listMembers = async (orgId) => {
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: orgId },
    select: memberSelect,
    orderBy: { createdAt: 'asc' },
  })

  return { members }
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
