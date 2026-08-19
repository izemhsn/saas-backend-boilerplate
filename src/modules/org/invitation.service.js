import { randomBytes, createHash } from 'crypto'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client.js'
import { prisma } from '../../config/db.js'
import { httpError } from '../../utils/httpError.js'
import { paginationParams, paginationMeta, parseSort, buildSearch } from '../../utils/query.js'

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

const hashToken = (token) => createHash('sha256').update(token).digest('hex')

const normalizeEmail = (email) => email.trim().toLowerCase()

const invitationSelect = {
  id: true,
  role: true,
  status: true,
  expiresAt: true,
  acceptedAt: true,
  declinedAt: true,
  canceledAt: true,
  createdAt: true,
  updatedAt: true,
  inviteeEmail: true,
  inviteeId: true,
  organization: {
    select: { id: true, name: true, slug: true },
  },
  inviter: {
    select: { id: true, name: true, email: true },
  },
}

export const createInvitation = async (orgId, inviterId, { email, role }) => {
  const inviteeEmail = normalizeEmail(email)

  if (role === 'OWNER') throw httpError('errors.cannotInviteAsOwner', 400)

  // Check if user is already a member (soft-deleted users don't count)
  const existingMember = await prisma.user.findFirst({
    where: { email: inviteeEmail, deletedAt: null },
    select: {
      id: true,
      memberships: {
        where: { organizationId: orgId },
        select: { id: true },
      },
    },
  })

  if (existingMember?.memberships.length) {
    throw httpError('errors.userAlreadyMember', 409)
  }

  // Check for existing pending invitation
  const existingInvitation = await prisma.organizationInvitation.findFirst({
    where: {
      organizationId: orgId,
      inviteeEmail,
      status: 'PENDING',
    },
    select: { id: true },
  })

  if (existingInvitation) {
    throw httpError('errors.pendingInvitationExists', 409)
  }

  const token = randomBytes(32).toString('hex')
  try {
    const invitation = await prisma.organizationInvitation.create({
      data: {
        organizationId: orgId,
        inviterId,
        inviteeEmail,
        inviteeId: existingMember?.id ?? null,
        role,
        token: hashToken(token),
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
      select: invitationSelect,
    })
    return { invitation, token }
  } catch (err) {
    // P2002 = the partial unique index on (organizationId, inviteeEmail)
    // WHERE status = 'PENDING' fired — a concurrent request created the same
    // pending invitation between our check and this insert.
    if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
      throw httpError('errors.pendingInvitationExists', 409)
    }
    throw err
  }
}

export const listInvitations = async (orgId, query = {}) => {
  const { page, limit, search, sort, order } = query

  const where = { organizationId: orgId }

  const searchClause = buildSearch(search, ['inviteeEmail', 'inviter.name', 'inviter.email'])
  if (searchClause) where.OR = searchClause

  const [invitations, total] = await Promise.all([
    prisma.organizationInvitation.findMany({
      where,
      select: invitationSelect,
      orderBy: parseSort(sort, order, ['createdAt', 'status', 'expiresAt']),
      ...paginationParams(page ?? 1, limit ?? 20),
    }),
    prisma.organizationInvitation.count({ where }),
  ])

  return {
    invitations,
    pagination: paginationMeta(page ?? 1, limit ?? 20, total),
  }
}

export const listMyInvitations = async (userId, query = {}) => {
  const { page, limit, search, sort, order } = query

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { email: true },
  })
  if (!user) throw httpError('errors.userNotFound', 404)

  const where = {
    inviteeEmail: user.email,
    status: 'PENDING',
  }

  const searchClause = buildSearch(search, ['organization.name', 'organization.slug'])
  if (searchClause) where.OR = searchClause

  const [invitations, total] = await Promise.all([
    prisma.organizationInvitation.findMany({
      where,
      select: invitationSelect,
      orderBy: parseSort(sort, order, ['createdAt', 'expiresAt']),
      ...paginationParams(page ?? 1, limit ?? 20),
    }),
    prisma.organizationInvitation.count({ where }),
  ])

  return {
    invitations,
    pagination: paginationMeta(page ?? 1, limit ?? 20, total),
  }
}

export const acceptInvitation = async (userId, token) => {
  const invitation = await prisma.organizationInvitation.findUnique({
    where: { token: hashToken(token) },
    select: {
      id: true,
      organizationId: true,
      inviteeEmail: true,
      inviteeId: true,
      role: true,
      status: true,
      expiresAt: true,
    },
  })

  if (!invitation) throw httpError('errors.invitationNotFound', 404)
  if (invitation.status !== 'PENDING') throw httpError('errors.invitationNotPending', 400)
  if (invitation.expiresAt < new Date()) {
    await prisma.organizationInvitation.update({
      where: { id: invitation.id },
      data: { status: 'EXPIRED' },
    })
    throw httpError('errors.invitationExpired', 400)
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { email: true },
  })

  if (!user || user.email !== invitation.inviteeEmail) {
    throw httpError('errors.invitationNotForYou', 403)
  }

  // Check if already a member (edge case: joined via another path)
  const existingMember = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId: invitation.organizationId, userId },
    },
    select: { id: true },
  })

  if (existingMember) {
    await prisma.organizationInvitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date(), inviteeId: userId },
    })
    throw httpError('errors.alreadyMember', 409)
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.organizationInvitation.update({
      where: { id: invitation.id },
      data: {
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        inviteeId: userId,
      },
      select: invitationSelect,
    })

    await tx.organizationMember.create({
      data: {
        organizationId: invitation.organizationId,
        userId,
        role: invitation.role,
      },
    })

    return updated
  })

  return { invitation: result }
}

export const declineInvitation = async (userId, token) => {
  const invitation = await prisma.organizationInvitation.findUnique({
    where: { token: hashToken(token) },
    select: { id: true, inviteeEmail: true, status: true, expiresAt: true },
  })

  if (!invitation) throw httpError('errors.invitationNotFound', 404)
  if (invitation.status !== 'PENDING') throw httpError('errors.invitationNotPending', 400)
  if (invitation.expiresAt < new Date()) {
    await prisma.organizationInvitation.update({
      where: { id: invitation.id },
      data: { status: 'EXPIRED' },
    })
    throw httpError('errors.invitationExpired', 400)
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { email: true },
  })

  if (!user || user.email !== invitation.inviteeEmail) {
    throw httpError('errors.invitationNotForYou', 403)
  }

  const updated = await prisma.organizationInvitation.update({
    where: { id: invitation.id },
    data: { status: 'DECLINED', declinedAt: new Date() },
    select: invitationSelect,
  })

  return { invitation: updated }
}

export const cancelInvitation = async (orgId, invitationId) => {
  const invitation = await prisma.organizationInvitation.findFirst({
    where: { id: invitationId, organizationId: orgId },
    select: { id: true, status: true },
  })

  if (!invitation) throw httpError('errors.invitationNotFound', 404)
  if (invitation.status !== 'PENDING') throw httpError('errors.invitationNotPending', 400)

  const updated = await prisma.organizationInvitation.update({
    where: { id: invitation.id },
    data: { status: 'CANCELED', canceledAt: new Date() },
    select: invitationSelect,
  })

  return { invitation: updated }
}
