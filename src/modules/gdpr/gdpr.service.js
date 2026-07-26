import { prisma } from '../../config/db.js'
import { httpError } from '../../utils/httpError.js'
import { comparePassword } from '../../utils/hash.js'

// ── Data Export ─────────────────────────────────────────────────────

export const exportData = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      emailVerified: true,
      googleId: true,
      createdAt: true,
      updatedAt: true,
      lastLoginAt: true,
      banned: true,
      suspendedUntil: true,
      stripeCustomerId: true,
    },
  })

  if (!user) throw httpError('User not found', 404)

  const [refreshTokens, memberships, ownedOrganizations, subscriptions, apiKeys, auditLogs, sentInvitations, receivedInvitations, notifications, notificationPreference] =
    await Promise.all([
      prisma.refreshToken.findMany({
        where: { userId },
        select: { id: true, userAgent: true, ipAddress: true, revoked: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.organizationMember.findMany({
        where: { userId },
        select: { id: true, role: true, createdAt: true, organization: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.organization.findMany({
        where: { ownerId: userId, deletedAt: null },
        select: { id: true, name: true, slug: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.subscription.findMany({
        where: { userId },
        select: { id: true, status: true, trialEndsAt: true, currentPeriodStart: true, currentPeriodEnd: true, canceledAt: true, createdAt: true, plan: { select: { name: true, interval: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.apiKey.findMany({
        where: { userId, deletedAt: null },
        select: { id: true, name: true, keyPrefix: true, scopes: true, lastUsedAt: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.findMany({
        where: { userId },
        select: { id: true, action: true, ipAddress: true, userAgent: true, metadata: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.organizationInvitation.findMany({
        where: { inviterId: userId },
        select: { id: true, inviteeEmail: true, role: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.organizationInvitation.findMany({
        where: { inviteeId: userId },
        select: { id: true, inviteeEmail: true, role: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.findMany({
        where: { userId },
        select: { id: true, type: true, title: true, message: true, readAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      prisma.notificationPreference.findUnique({
        where: { userId },
        select: { emailEnabled: true, pushEnabled: true, inAppEnabled: true, mutedTypes: true },
      }),
    ])

  return {
    user,
    refreshTokens,
    memberships,
    ownedOrganizations,
    subscriptions,
    apiKeys,
    auditLogs,
    sentInvitations,
    receivedInvitations,
    notifications,
    notificationPreference,
    exportedAt: new Date().toISOString(),
  }
}

// ── Account Deletion (hard delete) ──────────────────────────────────

export const deleteAccount = async (userId, password) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, password: true, role: true, email: true },
  })

  if (!user) throw httpError('User not found', 404)

  // OAuth-only accounts have no password — they must unlink Google first
  // or use a different deletion path. For now, reject with a helpful message.
  if (!user.password) {
    throw httpError('This account has no password set. Please set a password before deleting your account.', 400)
  }

  const valid = await comparePassword(password, user.password)
  if (!valid) throw httpError('Password is incorrect', 401)

  // Prevent the last admin from deleting their account
  if (user.role === 'ADMIN') {
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN', deletedAt: null } })
    if (adminCount <= 1) throw httpError('Cannot delete the last admin account', 400)
  }

  // Hard delete — cascades to refreshTokens, memberships, subscriptions,
  // apiKeys, notifications, notificationPreference, sentInvitations.
  // AuditLog.userId is SetNull, receivedInvitations.inviteeId is SetNull.
  // Owned organizations are cascade-deleted (onDelete: Cascade on OrgOwner).
  await prisma.user.delete({ where: { id: userId } })

  return { message: 'Account deleted successfully', email: user.email }
}
