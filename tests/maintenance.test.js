import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'
import {
  cleanupRefreshTokens,
  cleanupTwoFactorChallenges,
  cleanupAuditLogs,
  cleanupNotifications,
  cleanupTerminalInvitations,
  cleanupFailedJobs,
} from '../src/modules/jobs/maintenance.worker.js'

// M6: the maintenance worker previously only pruned RefreshToken — these
// tests pin the five new cleanup jobs (2FA challenges, audit logs,
// notifications, terminal invitations, dead-lettered jobs) directly, without
// going through BullMQ, since the job functions are exported for exactly this.
const RUN_ID = Date.now()
const emailFor = (label) => `maint-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'
const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000)

const createdEmails = []
const createdUserIds = []
const createdOrgIds = []
const createdFailedJobIds = []

const registerUser = async (label) => {
  const email = emailFor(label)
  createdEmails.push(email)
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: `Test ${label}`, email, password: VALID_PASSWORD })
  createdUserIds.push(res.body.data.user.id)
  return { email, userId: res.body.data.user.id }
}

const createOrg = async (label, ownerId) => {
  const org = await prisma.organization.create({
    data: { name: `Org ${label}`, slug: `maint-org-${label}-${RUN_ID}`, ownerId },
  })
  createdOrgIds.push(org.id)
  return org
}

afterAll(async () => {
  if (createdOrgIds.length) {
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } })
  }
  if (createdFailedJobIds.length) {
    await prisma.failedJob.deleteMany({ where: { id: { in: createdFailedJobIds } } })
  }
  await prisma.twoFactorChallenge.deleteMany({ where: { userId: { in: createdUserIds } } })
  await prisma.auditLog.deleteMany({ where: { userId: { in: createdUserIds } } })
  await prisma.notification.deleteMany({ where: { userId: { in: createdUserIds } } })
  await prisma.refreshToken.deleteMany({ where: { user: { email: { in: createdEmails } } } })
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } })
  await prisma.$disconnect()
})

describe('maintenance worker — data retention cleanup jobs', () => {
  it('cleanupRefreshTokens removes only expired/long-revoked tokens', async () => {
    const { userId } = await registerUser('refresh')

    const expired = await prisma.refreshToken.create({
      data: {
        token: `rt-expired-${RUN_ID}`,
        userId,
        expiresAt: daysAgo(1),
      },
    })
    const revokedOld = await prisma.refreshToken.create({
      data: {
        token: `rt-revoked-old-${RUN_ID}`,
        userId,
        expiresAt: daysAgo(-30),
        revoked: true,
        updatedAt: daysAgo(10),
      },
    })
    const live = await prisma.refreshToken.create({
      data: {
        token: `rt-live-${RUN_ID}`,
        userId,
        expiresAt: daysAgo(-30),
      },
    })

    await cleanupRefreshTokens()

    const remaining = await prisma.refreshToken.findMany({
      where: { id: { in: [expired.id, revokedOld.id, live.id] } },
      select: { id: true },
    })
    expect(remaining.map((r) => r.id)).toEqual([live.id])
  })

  it('cleanupTwoFactorChallenges removes only expired challenges', async () => {
    const { userId } = await registerUser('2fa')

    const expired = await prisma.twoFactorChallenge.create({
      data: { token: `tfc-expired-${RUN_ID}`, userId, expiresAt: daysAgo(1) },
    })
    const active = await prisma.twoFactorChallenge.create({
      data: { token: `tfc-active-${RUN_ID}`, userId, expiresAt: daysAgo(-1) },
    })

    await cleanupTwoFactorChallenges()

    const remaining = await prisma.twoFactorChallenge.findMany({
      where: { id: { in: [expired.id, active.id] } },
      select: { id: true },
    })
    expect(remaining.map((r) => r.id)).toEqual([active.id])
  })

  it('cleanupAuditLogs removes only rows past the retention window', async () => {
    const { userId } = await registerUser('audit')

    const old = await prisma.auditLog.create({
      data: { action: 'USER_LOGIN', userId, createdAt: daysAgo(400) },
    })
    const recent = await prisma.auditLog.create({
      data: { action: 'USER_LOGIN', userId, createdAt: daysAgo(1) },
    })

    await cleanupAuditLogs()

    const remaining = await prisma.auditLog.findMany({
      where: { id: { in: [old.id, recent.id] } },
      select: { id: true },
    })
    expect(remaining.map((r) => r.id)).toEqual([recent.id])
  })

  it('cleanupNotifications removes only rows past the retention window', async () => {
    const { userId } = await registerUser('notif')

    const old = await prisma.notification.create({
      data: {
        userId,
        type: 'SYSTEM',
        title: 'Old',
        message: 'old notification',
        createdAt: daysAgo(120),
      },
    })
    const recent = await prisma.notification.create({
      data: {
        userId,
        type: 'SYSTEM',
        title: 'Recent',
        message: 'recent notification',
        createdAt: daysAgo(1),
      },
    })

    await cleanupNotifications()

    const remaining = await prisma.notification.findMany({
      where: { id: { in: [old.id, recent.id] } },
      select: { id: true },
    })
    expect(remaining.map((r) => r.id)).toEqual([recent.id])
  })

  it('cleanupTerminalInvitations removes only old terminal invitations, never PENDING ones', async () => {
    const { userId: ownerId } = await registerUser('inv-owner')
    const org = await createOrg('cleanup', ownerId)

    const oldAccepted = await prisma.organizationInvitation.create({
      data: {
        organizationId: org.id,
        inviterId: ownerId,
        inviteeEmail: emailFor('inv-old-accepted'),
        role: 'MEMBER',
        status: 'ACCEPTED',
        token: `inv-old-accepted-${RUN_ID}`,
        expiresAt: daysAgo(-100),
        updatedAt: daysAgo(40),
      },
    })
    const recentDeclined = await prisma.organizationInvitation.create({
      data: {
        organizationId: org.id,
        inviterId: ownerId,
        inviteeEmail: emailFor('inv-recent-declined'),
        role: 'MEMBER',
        status: 'DECLINED',
        token: `inv-recent-declined-${RUN_ID}`,
        expiresAt: daysAgo(-100),
        updatedAt: daysAgo(2),
      },
    })
    const oldPending = await prisma.organizationInvitation.create({
      data: {
        organizationId: org.id,
        inviterId: ownerId,
        inviteeEmail: emailFor('inv-old-pending'),
        role: 'MEMBER',
        status: 'PENDING',
        token: `inv-old-pending-${RUN_ID}`,
        expiresAt: daysAgo(-100),
        updatedAt: daysAgo(40),
      },
    })

    await cleanupTerminalInvitations()

    const remaining = await prisma.organizationInvitation.findMany({
      where: { id: { in: [oldAccepted.id, recentDeclined.id, oldPending.id] } },
      select: { id: true },
    })
    expect(remaining.map((r) => r.id).sort()).toEqual([recentDeclined.id, oldPending.id].sort())
  })

  it('cleanupFailedJobs removes only rows past the retention window', async () => {
    const old = await prisma.failedJob.create({
      data: {
        queue: 'email',
        jobName: `old-${RUN_ID}`,
        jobData: {},
        error: 'boom',
        attempts: 3,
        failedAt: daysAgo(120),
      },
    })
    const recent = await prisma.failedJob.create({
      data: {
        queue: 'email',
        jobName: `recent-${RUN_ID}`,
        jobData: {},
        error: 'boom',
        attempts: 3,
        failedAt: daysAgo(1),
      },
    })
    createdFailedJobIds.push(old.id, recent.id)

    await cleanupFailedJobs()

    const remaining = await prisma.failedJob.findMany({
      where: { id: { in: [old.id, recent.id] } },
      select: { id: true },
    })
    expect(remaining.map((r) => r.id)).toEqual([recent.id])
  })
})
