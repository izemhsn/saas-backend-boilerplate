import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'

// Integration tests for the worked example resource. These run against the real
// `app`, not a throwaway express() instance, so they are what actually pins the
// gating middleware to live routes: if a guard is dropped from the router, a
// test here goes red.

const RUN_ID = Date.now()
const emailFor = (label) => `project-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdEmails = []
const createdOrgIds = []
const createdPlanIds = []
const createdFlagIds = []
const createdKeyIds = []

// Registers a user and marks the email verified — every project route sits
// behind `requireVerifiedEmail`, so an unverified user is tested explicitly
// rather than being the accidental default everywhere.
const registerUser = async (label, { verify = true } = {}) => {
  const email = emailFor(label)
  createdEmails.push(email)
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test User', email, password: VALID_PASSWORD })
  if (verify) {
    await prisma.user.update({
      where: { id: res.body.data.user.id },
      data: { emailVerified: true },
    })
  }
  return { email, token: res.body.data.token, userId: res.body.data.user.id }
}

const createOrg = async (token, slug) => {
  const res = await request(app)
    .post('/api/organizations')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `Org ${slug}`, slug: `${slug}-${RUN_ID}` })
  createdOrgIds.push(res.body.data.organization.id)
  return res.body.data.organization.id
}

const createProject = (token, orgId, name = 'Example Project') =>
  request(app)
    .post(`/api/organizations/${orgId}/projects`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name })

let owner
let orgId

beforeAll(async () => {
  owner = await registerUser('owner')
  orgId = await createOrg(owner.token, 'main')
})

afterAll(async () => {
  await prisma.project.deleteMany({ where: { organizationId: { in: createdOrgIds } } })
  if (createdKeyIds.length) {
    await prisma.apiKey.deleteMany({ where: { id: { in: createdKeyIds } } })
  }
  if (createdFlagIds.length) {
    await prisma.organizationFeatureFlag.deleteMany({
      where: { featureFlagId: { in: createdFlagIds } },
    })
    await prisma.featureFlag.deleteMany({ where: { id: { in: createdFlagIds } } })
  }
  await prisma.subscription.deleteMany({ where: { user: { email: { in: createdEmails } } } })
  if (createdPlanIds.length) {
    // The router hardcodes requirePlan('pro', 'enterprise'), matched on the
    // plan's `code` (audit M11 — never `name`, which isn't unique), so this
    // file has to create a plan whose code is actually "pro"/"enterprise".
    // A test file running in parallel can find it by name and attach its own
    // subscription, and Plan->Subscription is Restrict — so clear anything
    // still pointing at these plans rather than failing the whole teardown.
    await prisma.subscription.deleteMany({ where: { planId: { in: createdPlanIds } } })
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } })
  }
  if (createdOrgIds.length) {
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } })
  }
  await prisma.refreshToken.deleteMany({ where: { user: { email: { in: createdEmails } } } })
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } })
  await prisma.$disconnect()
})

describe('Project CRUD', () => {
  it('creates a project as the org owner', async () => {
    const res = await createProject(owner.token, orgId, 'First Project')

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.project.name).toBe('First Project')
    expect(res.body.data.project.organizationId).toBe(orgId)
    expect(res.body.data.project.status).toBe('ACTIVE')
    expect(res.body.data.message).toBe('Project created successfully')
  })

  it('lists projects with pagination metadata', async () => {
    await createProject(owner.token, orgId, 'Listed Project')

    const res = await request(app)
      .get(`/api/organizations/${orgId}/projects`)
      .set('Authorization', `Bearer ${owner.token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data.projects)).toBe(true)
    expect(res.body.data.meta.total).toBeGreaterThanOrEqual(1)
  })

  it('gets a single project', async () => {
    const created = await createProject(owner.token, orgId, 'Fetch Me')
    const id = created.body.data.project.id

    const res = await request(app)
      .get(`/api/organizations/${orgId}/projects/${id}`)
      .set('Authorization', `Bearer ${owner.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.project.id).toBe(id)
  })

  it('updates a project', async () => {
    const created = await createProject(owner.token, orgId, 'Before Update')
    const id = created.body.data.project.id

    const res = await request(app)
      .patch(`/api/organizations/${orgId}/projects/${id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'After Update', status: 'ARCHIVED' })

    expect(res.status).toBe(200)
    expect(res.body.data.project.name).toBe('After Update')
    expect(res.body.data.project.status).toBe('ARCHIVED')
  })

  it('soft-deletes a project and hides it from subsequent reads', async () => {
    const created = await createProject(owner.token, orgId, 'Delete Me')
    const id = created.body.data.project.id

    const del = await request(app)
      .delete(`/api/organizations/${orgId}/projects/${id}`)
      .set('Authorization', `Bearer ${owner.token}`)
    expect(del.status).toBe(200)

    const get = await request(app)
      .get(`/api/organizations/${orgId}/projects/${id}`)
      .set('Authorization', `Bearer ${owner.token}`)
    expect(get.status).toBe(404)

    // Soft delete, not a row removal
    const row = await prisma.project.findUnique({ where: { id } })
    expect(row).not.toBeNull()
    expect(row.deletedAt).not.toBeNull()
  })

  it('rejects an invalid payload with field-level errors', async () => {
    const res = await request(app)
      .post(`/api/organizations/${orgId}/projects`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: '' })

    expect(res.status).toBe(400)
    expect(res.body.errors.name).toBeDefined()
    expect(res.body.errors.body).toBeUndefined()
  })
})

describe('Guard: authenticate', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get(`/api/organizations/${orgId}/projects`)
    expect(res.status).toBe(401)
  })

  it('rejects a malformed token', async () => {
    const res = await request(app)
      .get(`/api/organizations/${orgId}/projects`)
      .set('Authorization', 'Bearer not-a-real-token')
    expect(res.status).toBe(401)
  })
})

describe('Guard: requireVerifiedEmail', () => {
  it('rejects a member whose email is not verified', async () => {
    const unverified = await registerUser('unverified', { verify: false })

    // Make them a real member so the failure is attributable to verification
    await prisma.organizationMember.create({
      data: { organizationId: orgId, userId: unverified.userId, role: 'MEMBER' },
    })

    const res = await request(app)
      .get(`/api/organizations/${orgId}/projects`)
      .set('Authorization', `Bearer ${unverified.token}`)

    expect(res.status).toBe(403)
    expect(res.body.message).toBe('Email not verified')
  })
})

describe('Guard: requireTenant — cross-tenant isolation', () => {
  it('denies a user who is not a member of the organization', async () => {
    const outsider = await registerUser('outsider')

    const res = await request(app)
      .get(`/api/organizations/${orgId}/projects`)
      .set('Authorization', `Bearer ${outsider.token}`)

    expect(res.status).toBe(403)
  })

  it('denies writes into an organization the caller does not belong to', async () => {
    const outsider = await registerUser('outsider-write')

    const res = await createProject(outsider.token, orgId, 'Should Not Exist')
    expect(res.status).toBe(403)
  })

  it('returns 404 for a project id belonging to a different org', async () => {
    const other = await registerUser('other-tenant')
    const otherOrgId = await createOrg(other.token, 'other')

    const created = await createProject(other.token, otherOrgId, 'Other Org Project')
    expect(created.status).toBe(201)
    const foreignProjectId = created.body.data.project.id

    // Owner of the first org asks for the second org's project id via their own org
    const res = await request(app)
      .get(`/api/organizations/${orgId}/projects/${foreignProjectId}`)
      .set('Authorization', `Bearer ${owner.token}`)

    expect(res.status).toBe(404)
    expect(res.body.project).toBeUndefined()
  })

  it('does not leak projects from another org into a list response', async () => {
    const other = await registerUser('leak-check')
    const otherOrgId = await createOrg(other.token, 'leak')
    await createProject(other.token, otherOrgId, 'Secret Project')

    const res = await request(app)
      .get(`/api/organizations/${orgId}/projects?limit=100`)
      .set('Authorization', `Bearer ${owner.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.projects.every((p) => p.organizationId === orgId)).toBe(true)
    expect(res.body.data.projects.some((p) => p.name === 'Secret Project')).toBe(false)
  })
})

describe('Guard: requireOrgRole', () => {
  it('lets a MEMBER read but not create', async () => {
    const member = await registerUser('member')
    await prisma.organizationMember.create({
      data: { organizationId: orgId, userId: member.userId, role: 'MEMBER' },
    })

    const read = await request(app)
      .get(`/api/organizations/${orgId}/projects`)
      .set('Authorization', `Bearer ${member.token}`)
    expect(read.status).toBe(200)

    const write = await createProject(member.token, orgId, 'Member Attempt')
    expect(write.status).toBe(403)
  })

  it('lets an ADMIN create but not delete', async () => {
    const admin = await registerUser('admin')
    await prisma.organizationMember.create({
      data: { organizationId: orgId, userId: admin.userId, role: 'ADMIN' },
    })

    const created = await createProject(admin.token, orgId, 'Admin Project')
    expect(created.status).toBe(201)

    const del = await request(app)
      .delete(`/api/organizations/${orgId}/projects/${created.body.data.project.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
    expect(del.status).toBe(403)
  })
})

describe('Guard: requireSubscription / requirePlan / requireFeatureFlag on /export', () => {
  let freePlanId
  let proPlanId

  // The router hardcodes the flag key, so unlike the per-run emails this one
  // cannot be made unique. Clear it first so "flag absent" is a real starting
  // state even if an earlier run died before its cleanup.
  const EXPORT_FLAG_KEY = 'projects_export'

  const clearExportFlag = async () => {
    const existing = await prisma.featureFlag.findUnique({ where: { key: EXPORT_FLAG_KEY } })
    if (!existing) return
    await prisma.organizationFeatureFlag.deleteMany({ where: { featureFlagId: existing.id } })
    await prisma.featureFlag.delete({ where: { id: existing.id } })
  }

  // `requirePlan` matches on the plan's `code` (audit M11), so these cannot be
  // given a per-run suffix the way emails are. Reuse a plan of that code if
  // the seed or another file already made one, and only track for deletion
  // what we created.
  const ensurePlan = async (name, priceCents, slug) => {
    const existing = await prisma.plan.findFirst({ where: { code: slug, active: true } })
    if (existing) return existing.id

    const plan = await prisma.plan.create({
      data: {
        name,
        // Literal, not RUN_ID-suffixed — the router hardcodes
        // requirePlan('pro', 'enterprise'), matched on code, so this must be
        // the exact string it expects. Same reason `name` above is literal.
        code: slug,
        stripePriceId: `price_proj_${slug}_${RUN_ID}`,
        priceCents,
        currency: 'usd',
        interval: 'MONTH',
        features: {},
        active: true,
      },
    })
    createdPlanIds.push(plan.id)
    return plan.id
  }

  beforeAll(async () => {
    await clearExportFlag()

    freePlanId = await ensurePlan('Free', 0, 'free')
    proPlanId = await ensurePlan('Pro', 1999, 'pro')
  })

  const subscribe = (userId, planId) =>
    prisma.subscription.create({
      data: {
        userId,
        planId,
        status: 'ACTIVE',
        stripeSubscriptionId: `sub_${userId}_${Date.now()}`,
        stripeCustomerId: `cus_${userId}`,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    })

  const enableFlag = async (key) => {
    const flag = await prisma.featureFlag.create({
      data: {
        key,
        name: 'Projects Export',
        type: 'BOOLEAN',
        value: { enabled: true },
        active: true,
      },
    })
    createdFlagIds.push(flag.id)
    return flag
  }

  it('returns 402 without an active subscription', async () => {
    const res = await request(app)
      .get(`/api/organizations/${orgId}/projects/export`)
      .set('Authorization', `Bearer ${owner.token}`)

    expect(res.status).toBe(402)
  })

  it('returns 403 with a subscription on the wrong plan', async () => {
    const user = await registerUser('free-plan')
    await prisma.organizationMember.create({
      data: { organizationId: orgId, userId: user.userId, role: 'MEMBER' },
    })
    await subscribe(user.userId, freePlanId)

    const res = await request(app)
      .get(`/api/organizations/${orgId}/projects/export`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(403)
  })

  it('returns 403 on the right plan while the feature flag is absent', async () => {
    const user = await registerUser('pro-noflag')
    await prisma.organizationMember.create({
      data: { organizationId: orgId, userId: user.userId, role: 'MEMBER' },
    })
    await subscribe(user.userId, proPlanId)

    const res = await request(app)
      .get(`/api/organizations/${orgId}/projects/export`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(403)
  })

  it('returns 200 with an active Pro subscription and the flag enabled', async () => {
    await enableFlag(EXPORT_FLAG_KEY)

    const user = await registerUser('pro-flag')
    await prisma.organizationMember.create({
      data: { organizationId: orgId, userId: user.userId, role: 'MEMBER' },
    })
    await subscribe(user.userId, proPlanId)

    const res = await request(app)
      .get(`/api/organizations/${orgId}/projects/export`)
      .set('Authorization', `Bearer ${user.token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data.projects)).toBe(true)
    expect(res.body.data.exportedAt).toBeDefined()
  })
})

describe('Guard: requireOrgSubscription / requirePlan on /analytics (M12)', () => {
  let freePlanId
  let proPlanId

  // Same plans the /export suite above uses (code 'free'/'pro', matching what
  // the router hardcodes) — reuse them if that suite already created them
  // rather than assuming describe-block ordering.
  beforeAll(async () => {
    const free = await prisma.plan.findFirst({ where: { code: 'free', active: true } })
    freePlanId =
      free?.id ??
      (
        await prisma.plan.create({
          data: {
            name: 'Free',
            code: 'free',
            stripePriceId: `price_proj_free_${RUN_ID}_analytics`,
            priceCents: 0,
            currency: 'usd',
            interval: 'MONTH',
            active: true,
          },
        })
      ).id
    if (!free) createdPlanIds.push(freePlanId)

    const pro = await prisma.plan.findFirst({ where: { code: 'pro', active: true } })
    proPlanId =
      pro?.id ??
      (
        await prisma.plan.create({
          data: {
            name: 'Pro',
            code: 'pro',
            stripePriceId: `price_proj_pro_${RUN_ID}_analytics`,
            priceCents: 1999,
            currency: 'usd',
            interval: 'MONTH',
            active: true,
          },
        })
      ).id
    if (!pro) createdPlanIds.push(proPlanId)
  })

  // Unlike /export's `subscribe` (scoped to userId), the subscription here
  // belongs to the organization itself — the whole point of requireOrgSubscription.
  const subscribeOrg = (organizationId, planId) =>
    prisma.subscription.create({
      data: {
        organizationId,
        planId,
        status: 'ACTIVE',
        stripeSubscriptionId: `sub_org_${organizationId}_${Date.now()}`,
        stripeCustomerId: `cus_org_${organizationId}`,
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      },
    })

  it('returns 402 without an active org subscription', async () => {
    const res = await request(app)
      .get(`/api/organizations/${orgId}/projects/analytics`)
      .set('Authorization', `Bearer ${owner.token}`)

    expect(res.status).toBe(402)
  })

  it('returns 403 with an org subscription on the wrong plan', async () => {
    const org = await createOrg(owner.token, 'analytics-free')
    await subscribeOrg(org, freePlanId)

    const res = await request(app)
      .get(`/api/organizations/${org}/projects/analytics`)
      .set('Authorization', `Bearer ${owner.token}`)

    expect(res.status).toBe(403)
  })

  it("returns 200 with the org's own Pro subscription, ignoring the caller's personal plan", async () => {
    const org = await createOrg(owner.token, 'analytics-pro')
    await subscribeOrg(org, proPlanId)
    await createProject(owner.token, org, 'Analytics Project')

    // The owner has no *personal* subscription anywhere in this suite — only
    // the organization does. A pass here proves the gate reads req.tenant,
    // not req.user.
    const res = await request(app)
      .get(`/api/organizations/${org}/projects/analytics`)
      .set('Authorization', `Bearer ${owner.token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.total).toBeGreaterThanOrEqual(1)
    expect(res.body.data.byStatus.ACTIVE).toBeGreaterThanOrEqual(1)
  })
})

describe('Guard: authenticateApiKey / requireScope', () => {
  const createKey = async (token, scopes) => {
    const res = await request(app)
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Project Key', scopes })
    createdKeyIds.push(res.body.data.apiKey.id)
    return res.body.data.key
  }

  it('rejects a request with no API key', async () => {
    const res = await request(app).get(`/api/integrations/organizations/${orgId}/projects`)
    expect(res.status).toBe(401)
  })

  it('rejects an unknown API key', async () => {
    const res = await request(app)
      .get(`/api/integrations/organizations/${orgId}/projects`)
      .set('X-API-Key', 'sk_not_a_real_key')
    expect(res.status).toBe(401)
  })

  it('rejects a valid key that lacks the projects:read scope', async () => {
    const key = await createKey(owner.token, ['billing:read'])

    const res = await request(app)
      .get(`/api/integrations/organizations/${orgId}/projects`)
      .set('X-API-Key', key)

    expect(res.status).toBe(403)
  })

  it('lists projects with a correctly scoped key', async () => {
    const key = await createKey(owner.token, ['projects:read'])

    const res = await request(app)
      .get(`/api/integrations/organizations/${orgId}/projects`)
      .set('X-API-Key', key)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data.projects)).toBe(true)
  })

  it('cannot reach an organization the key owner does not belong to', async () => {
    const stranger = await registerUser('key-stranger')
    const strangerOrgId = await createOrg(stranger.token, 'key-stranger')

    const key = await createKey(owner.token, ['projects:read'])

    const res = await request(app)
      .get(`/api/integrations/organizations/${strangerOrgId}/projects`)
      .set('X-API-Key', key)

    expect(res.status).toBe(403)
  })
})
