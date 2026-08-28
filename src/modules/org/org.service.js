import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client.js'
import { prisma } from '../../config/db.js'
import { stripe, isStripeConfigured } from '../../config/stripe.js'
import { httpError } from '../../utils/httpError.js'
import { paginationParams, paginationMeta, parseSort, buildSearch } from '../../utils/query.js'
import { LIVE_SUBSCRIPTION_STATUSES } from '../billing/billing.service.js'
import logger from '../../utils/logger.js'

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
  const existing = await prisma.organization.findFirst({
    where: { slug, deletedAt: null },
    select: { id: true },
  })
  if (existing) throw httpError('errors.slugAlreadyTaken', 409)

  try {
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
  } catch (err) {
    // P2002 = unique constraint violation. The pre-check above ignores
    // soft-deleted orgs, but the DB unique constraint on slug covers them
    // (and concurrent creates) — return a clean 409 instead of a 500.
    if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
      throw httpError('errors.slugAlreadyTaken', 409)
    }
    throw err
  }
}

export const listOrganizations = async (userId, query = {}) => {
  const { page, limit, search, sort, order } = query

  const where = { userId, organization: { deletedAt: null } }

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
  const organization = await prisma.organization.findFirst({
    where: { id: orgId, deletedAt: null },
    select: orgSelect,
  })
  if (!organization) throw httpError('errors.organizationNotFound', 404)

  return { organization }
}

export const updateOrganization = async (orgId, { name, slug }) => {
  if (slug) {
    const existing = await prisma.organization.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true },
    })
    if (existing && existing.id !== orgId) throw httpError('errors.slugAlreadyTaken', 409)
  }

  const data = {}
  if (name !== undefined) data.name = name.trim()
  if (slug !== undefined) data.slug = slug

  try {
    const organization = await prisma.organization.update({
      where: { id: orgId },
      data,
      select: orgSelect,
    })
    return { organization }
  } catch (err) {
    if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
      throw httpError('errors.slugAlreadyTaken', 409)
    }
    throw err
  }
}

export const deleteOrganization = async (orgId) => {
  // An organization can hold its own Stripe subscription (org-scoped billing,
  // M12). Soft-deleting the org removes it from every API surface —
  // requireTenant rejects deleted orgs — so leaving the subscription live
  // would keep charging a customer for something they can no longer see, use,
  // or even cancel through this API. Cancel first, and fail the request if
  // Stripe rejects, rather than delete while still billing: the same rule the
  // hard-delete path in gdpr.service.js follows.
  //
  // Deliberately not reversed by POST /:orgId/restore. Cancellation at Stripe
  // is not something this API can undo, so a restored org starts a fresh
  // checkout — which is the honest outcome. Billing someone for an
  // organization they deleted is the worse failure of the two.
  if (isStripeConfigured()) {
    const liveSubscriptions = await prisma.subscription.findMany({
      where: { organizationId: orgId, status: { in: LIVE_SUBSCRIPTION_STATUSES } },
      select: { id: true, stripeSubscriptionId: true },
    })

    for (const sub of liveSubscriptions) {
      try {
        await stripe.subscriptions.cancel(sub.stripeSubscriptionId)
      } catch (err) {
        logger.error(
          { err, organizationId: orgId, stripeSubscriptionId: sub.stripeSubscriptionId },
          'Failed to cancel Stripe subscription during organization deletion',
        )
        throw httpError('errors.stripeCancellationFailed', 502)
      }
    }

    if (liveSubscriptions.length) {
      await prisma.subscription.updateMany({
        where: { id: { in: liveSubscriptions.map((sub) => sub.id) } },
        data: { status: 'CANCELED', canceledAt: new Date() },
      })
    }
  }

  await prisma.organization.update({ where: { id: orgId }, data: { deletedAt: new Date() } })
  return { messageKey: 'messages.organizationDeletedSuccessfully' }
}

export const restoreOrganization = async (orgId) => {
  const org = await prisma.organization.findFirst({
    where: { id: orgId, deletedAt: { not: null } },
    select: { id: true },
  })
  if (!org) throw httpError('errors.deletedOrganizationNotFound', 404)

  await prisma.organization.update({
    where: { id: orgId },
    data: { deletedAt: null },
    select: orgSelect,
  })

  return { messageKey: 'messages.organizationRestoredSuccessfully' }
}

export const listMembers = async (orgId, query = {}) => {
  const { page, limit, search, sort, order } = query

  // Exclude memberships of soft-deleted users
  const where = { organizationId: orgId, user: { deletedAt: null } }

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
  if (!membership) throw httpError('errors.memberNotFound', 404)

  if (membership.role === 'OWNER') {
    throw httpError('errors.cannotChangeOwnerRole', 400)
  }

  const updated = await prisma.organizationMember.update({
    where: { id: membership.id },
    data: { role },
    select: memberSelect,
  })

  return { member: updated }
}

// Hands ownership of the org to an existing member, demoting the current
// owner to ADMIN. Required before an owner can delete their account while
// the org still has other members — see gdpr.service.js's deleteAccount.
export const transferOwnership = async (orgId, currentOwnerId, newOwnerId) => {
  if (newOwnerId === currentOwnerId) {
    throw httpError('errors.cannotTransferToSelf', 400)
  }

  const targetMembership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: newOwnerId } },
    select: { id: true },
  })
  if (!targetMembership) throw httpError('errors.memberNotFound', 404)

  const [organization] = await prisma.$transaction([
    prisma.organization.update({
      where: { id: orgId },
      data: { ownerId: newOwnerId },
      select: orgSelect,
    }),
    prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId: orgId, userId: newOwnerId } },
      data: { role: 'OWNER' },
    }),
    prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId: orgId, userId: currentOwnerId } },
      data: { role: 'ADMIN' },
    }),
  ])

  return { organization }
}

export const removeMember = async (orgId, targetUserId) => {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
    select: { id: true, role: true },
  })
  if (!membership) throw httpError('errors.memberNotFound', 404)

  if (membership.role === 'OWNER') {
    throw httpError('errors.cannotRemoveOwner', 400)
  }

  await prisma.organizationMember.delete({ where: { id: membership.id } })
  return { messageKey: 'messages.memberRemovedSuccessfully' }
}
