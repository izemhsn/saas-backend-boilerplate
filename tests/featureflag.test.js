import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'
import * as flagService from '../src/modules/featureflag/featureflag.service.js'

const RUN_ID = Date.now()
const emailFor = (label) => `test-flag-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdUserIds = []
const createdFlagIds = []
const createdOrgIds = []

async function registerUser(label, role = 'USER') {
  const email = emailFor(label)
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      name: `Test ${label}`,
      email,
      password: VALID_PASSWORD,
    })
  createdUserIds.push(res.body.data.user.id)

  if (role === 'ADMIN') {
    await prisma.user.update({ where: { id: res.body.data.user.id }, data: { role: 'ADMIN' } })
  }

  return { email, userId: res.body.data.user.id, token: res.body.data.token }
}

async function createOrg(ownerId, slug) {
  const org = await prisma.organization.create({
    data: {
      name: `Test Org ${slug}`,
      slug,
      ownerId,
      members: { create: { userId: ownerId, role: 'OWNER' } },
    },
    select: { id: true },
  })
  createdOrgIds.push(org.id)
  return org
}

afterAll(async () => {
  for (const flagId of createdFlagIds) {
    await prisma.organizationFeatureFlag.deleteMany({ where: { featureFlagId: flagId } })
    await prisma.featureFlag.delete({ where: { id: flagId } }).catch(() => {})
  }
  for (const orgId of createdOrgIds) {
    await prisma.organizationFeatureFlag.deleteMany({ where: { organizationId: orgId } })
    await prisma.organizationMember.deleteMany({ where: { organizationId: orgId } })
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {})
  }
  for (const userId of createdUserIds) {
    await prisma.refreshToken.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
  await prisma.$disconnect()
})

describe('POST /api/feature-flags', () => {
  it('creates a feature flag as admin', async () => {
    const { token } = await registerUser('create-admin', 'ADMIN')

    const res = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `test-flag-create-${RUN_ID}`,
        name: 'Test Flag',
        type: 'BOOLEAN',
        value: { enabled: true },
      })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.flag.key).toBe(`test-flag-create-${RUN_ID}`)
    expect(res.body.data.flag.type).toBe('BOOLEAN')
    expect(res.body.data.flag.value).toEqual({ enabled: true })
    createdFlagIds.push(res.body.data.flag.id)
  })

  it('rejects duplicate key', async () => {
    const { token } = await registerUser('dup-admin', 'ADMIN')
    const key = `test-flag-dup-${RUN_ID}`

    const res1 = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({ key, name: 'First Flag', type: 'BOOLEAN', value: { enabled: true } })
    createdFlagIds.push(res1.body.data.flag.id)

    const res2 = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({ key, name: 'Second Flag', type: 'BOOLEAN', value: { enabled: false } })

    expect(res2.status).toBe(409)
  })

  it('rejects non-admin', async () => {
    const { token } = await registerUser('create-user')

    const res = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `test-flag-noauth-${RUN_ID}`,
        name: 'Test',
        type: 'BOOLEAN',
        value: { enabled: true },
      })

    expect(res.status).toBe(403)
  })

  it('rejects without auth', async () => {
    const res = await request(app)
      .post('/api/feature-flags')
      .send({ key: 'no-auth', name: 'Test', type: 'BOOLEAN', value: { enabled: true } })

    expect(res.status).toBe(401)
  })
})

describe('GET /api/feature-flags', () => {
  it('lists flags as admin with pagination', async () => {
    const { token } = await registerUser('list-admin', 'ADMIN')

    const res = await request(app)
      .get('/api/feature-flags?page=1&limit=10')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(Array.isArray(res.body.data.flags)).toBe(true)
    expect(res.body.data.pagination).toBeDefined()
  })

  it('filters by type', async () => {
    const { token } = await registerUser('filter-admin', 'ADMIN')

    const res = await request(app)
      .get('/api/feature-flags?type=BOOLEAN')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.flags.every((f) => f.type === 'BOOLEAN')).toBe(true)
  })

  it('rejects non-admin', async () => {
    const { token } = await registerUser('list-user')

    const res = await request(app).get('/api/feature-flags').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })
})

describe('GET /api/feature-flags/:flagId', () => {
  it('gets a single flag with overrides', async () => {
    const { token } = await registerUser('get-admin', 'ADMIN')

    const createRes = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `test-flag-get-${RUN_ID}`,
        name: 'Get Flag',
        type: 'BOOLEAN',
        value: { enabled: false },
      })
    createdFlagIds.push(createRes.body.data.flag.id)

    const res = await request(app)
      .get(`/api/feature-flags/${createRes.body.data.flag.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.flag.key).toBe(`test-flag-get-${RUN_ID}`)
    expect(res.body.data.flag.overrides).toEqual([])
  })

  it('returns 404 for non-existent flag', async () => {
    const { token } = await registerUser('get-404', 'ADMIN')

    const res = await request(app)
      .get('/api/feature-flags/nonexistent-id')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/feature-flags/:flagId', () => {
  it('updates a flag', async () => {
    const { token } = await registerUser('update-admin', 'ADMIN')

    const createRes = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `test-flag-update-${RUN_ID}`,
        name: 'Update Flag',
        type: 'BOOLEAN',
        value: { enabled: false },
      })
    createdFlagIds.push(createRes.body.data.flag.id)

    const res = await request(app)
      .patch(`/api/feature-flags/${createRes.body.data.flag.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Name', active: false })

    expect(res.status).toBe(200)
    expect(res.body.data.flag.name).toBe('Updated Name')
    expect(res.body.data.flag.active).toBe(false)
  })

  it('rejects empty body', async () => {
    const { token } = await registerUser('update-empty', 'ADMIN')

    const createRes = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `test-flag-empty-${RUN_ID}`,
        name: 'Empty Update',
        type: 'BOOLEAN',
        value: { enabled: true },
      })
    createdFlagIds.push(createRes.body.data.flag.id)

    const res = await request(app)
      .patch(`/api/feature-flags/${createRes.body.data.flag.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/feature-flags/:flagId', () => {
  it('deletes a flag', async () => {
    const { token } = await registerUser('delete-admin', 'ADMIN')

    const createRes = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `test-flag-delete-${RUN_ID}`,
        name: 'Delete Flag',
        type: 'BOOLEAN',
        value: { enabled: true },
      })

    const res = await request(app)
      .delete(`/api/feature-flags/${createRes.body.data.flag.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.message).toMatch(/deleted/)

    const dbFlag = await prisma.featureFlag.findUnique({
      where: { id: createRes.body.data.flag.id },
    })
    expect(dbFlag).toBeNull()
  })

  it('returns 404 for non-existent flag', async () => {
    const { token } = await registerUser('delete-404', 'ADMIN')

    const res = await request(app)
      .delete('/api/feature-flags/nonexistent-id')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})

describe('POST /api/feature-flags/:flagId/overrides/:orgId', () => {
  it('sets an org override', async () => {
    const { token, userId } = await registerUser('override-admin', 'ADMIN')
    const org = await createOrg(userId, `override-org-${RUN_ID}`)

    const createRes = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `test-flag-override-${RUN_ID}`,
        name: 'Override Flag',
        type: 'BOOLEAN',
        value: { enabled: false },
      })
    createdFlagIds.push(createRes.body.data.flag.id)

    const res = await request(app)
      .post(`/api/feature-flags/${createRes.body.data.flag.id}/overrides/${org.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true, value: { enabled: true } })

    expect(res.status).toBe(200)
    expect(res.body.data.override.enabled).toBe(true)
    expect(res.body.data.override.value).toEqual({ enabled: true })
  })

  it('returns 404 for non-existent org', async () => {
    const { token } = await registerUser('override-noorg', 'ADMIN')

    const createRes = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `test-flag-noorg-${RUN_ID}`,
        name: 'No Org Flag',
        type: 'BOOLEAN',
        value: { enabled: false },
      })
    createdFlagIds.push(createRes.body.data.flag.id)

    const res = await request(app)
      .post(`/api/feature-flags/${createRes.body.data.flag.id}/overrides/nonexistent-org`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true })

    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/feature-flags/:flagId/overrides/:orgId', () => {
  it('removes an org override', async () => {
    const { token, userId } = await registerUser('rm-override-admin', 'ADMIN')
    const org = await createOrg(userId, `rm-override-org-${RUN_ID}`)

    const createRes = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `test-flag-rm-override-${RUN_ID}`,
        name: 'RM Override Flag',
        type: 'BOOLEAN',
        value: { enabled: false },
      })
    createdFlagIds.push(createRes.body.data.flag.id)

    await request(app)
      .post(`/api/feature-flags/${createRes.body.data.flag.id}/overrides/${org.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true, value: { enabled: true } })

    const res = await request(app)
      .delete(`/api/feature-flags/${createRes.body.data.flag.id}/overrides/${org.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.message).toMatch(/removed/)

    const override = await prisma.organizationFeatureFlag.findUnique({
      where: {
        featureFlagId_organizationId: {
          featureFlagId: createRes.body.data.flag.id,
          organizationId: org.id,
        },
      },
    })
    expect(override).toBeNull()
  })

  it('returns 404 for non-existent override', async () => {
    const { token, userId } = await registerUser('rm-override-404', 'ADMIN')
    const org = await createOrg(userId, `rm-404-org-${RUN_ID}`)

    const createRes = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `test-flag-rm404-${RUN_ID}`,
        name: 'RM 404 Flag',
        type: 'BOOLEAN',
        value: { enabled: false },
      })
    createdFlagIds.push(createRes.body.data.flag.id)

    const res = await request(app)
      .delete(`/api/feature-flags/${createRes.body.data.flag.id}/overrides/${org.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})

describe('GET /api/feature-flags/evaluate', () => {
  it('evaluates a BOOLEAN flag (enabled)', async () => {
    const { token } = await registerUser('eval-bool', 'ADMIN')

    const createRes = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `test-flag-eval-bool-${RUN_ID}`,
        name: 'Eval Bool',
        type: 'BOOLEAN',
        value: { enabled: true },
      })
    createdFlagIds.push(createRes.body.data.flag.id)

    const res = await request(app)
      .get(`/api/feature-flags/evaluate?key=test-flag-eval-bool-${RUN_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.enabled).toBe(true)
    expect(res.body.data.reason).toBe('DEFAULT')
  })

  it('evaluates a BOOLEAN flag (disabled)', async () => {
    const { token } = await registerUser('eval-bool-off', 'ADMIN')

    const createRes = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `test-flag-eval-off-${RUN_ID}`,
        name: 'Eval Off',
        type: 'BOOLEAN',
        value: { enabled: false },
      })
    createdFlagIds.push(createRes.body.data.flag.id)

    const res = await request(app)
      .get(`/api/feature-flags/evaluate?key=test-flag-eval-off-${RUN_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.enabled).toBe(false)
  })

  it('returns disabled for non-existent flag', async () => {
    const { token } = await registerUser('eval-missing')

    const res = await request(app)
      .get('/api/feature-flags/evaluate?key=nonexistent-flag-key')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.enabled).toBe(false)
    expect(res.body.data.reason).toBe('FLAG_NOT_FOUND_OR_INACTIVE')
  })

  it('evaluates with org override taking precedence', async () => {
    const { token, userId } = await registerUser('eval-override', 'ADMIN')
    const org = await createOrg(userId, `eval-override-org-${RUN_ID}`)

    const createRes = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `test-flag-eval-override-${RUN_ID}`,
        name: 'Eval Override',
        type: 'BOOLEAN',
        value: { enabled: false },
      })
    createdFlagIds.push(createRes.body.data.flag.id)

    await request(app)
      .post(`/api/feature-flags/${createRes.body.data.flag.id}/overrides/${org.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true, value: { enabled: true } })

    // Default is false, override is true
    const resDefault = await request(app)
      .get(`/api/feature-flags/evaluate?key=test-flag-eval-override-${RUN_ID}`)
      .set('Authorization', `Bearer ${token}`)
    expect(resDefault.body.data.enabled).toBe(false)

    const resOverride = await request(app)
      .get(`/api/feature-flags/evaluate?key=test-flag-eval-override-${RUN_ID}&orgId=${org.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(resOverride.body.data.enabled).toBe(true)
    expect(resOverride.body.data.reason).toBe('OVERRIDE')
  })

  it('evaluates a PLAN flag', async () => {
    const { token } = await registerUser('eval-plan', 'ADMIN')

    const createRes = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `test-flag-eval-plan-${RUN_ID}`,
        name: 'Eval Plan',
        type: 'PLAN',
        value: { plans: ['Pro', 'Enterprise'] },
      })
    createdFlagIds.push(createRes.body.data.flag.id)

    // Without planName (no org), should be false
    const res = await request(app)
      .get(`/api/feature-flags/evaluate?key=test-flag-eval-plan-${RUN_ID}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.enabled).toBe(false)
  })

  it('rejects without key param', async () => {
    const { token } = await registerUser('eval-no-key')

    const res = await request(app)
      .get('/api/feature-flags/evaluate')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
  })

  it('rejects without auth', async () => {
    const res = await request(app).get('/api/feature-flags/evaluate?key=some-key')
    expect(res.status).toBe(401)
  })
})

describe('Feature flag service — PERCENTAGE evaluation', () => {
  it('returns enabled for 100% rollout', async () => {
    const { token } = await registerUser('pct100', 'ADMIN')

    const createRes = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `test-flag-pct100-${RUN_ID}`,
        name: 'PCT 100',
        type: 'PERCENTAGE',
        value: { percentage: 100 },
      })
    createdFlagIds.push(createRes.body.data.flag.id)

    const result = await flagService.evaluateFlag(`test-flag-pct100-${RUN_ID}`)
    expect(result.enabled).toBe(true)
  })

  it('returns disabled for 0% rollout', async () => {
    const { token } = await registerUser('pct0', 'ADMIN')

    const createRes = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `test-flag-pct0-${RUN_ID}`,
        name: 'PCT 0',
        type: 'PERCENTAGE',
        value: { percentage: 0 },
      })
    createdFlagIds.push(createRes.body.data.flag.id)

    const result = await flagService.evaluateFlag(`test-flag-pct0-${RUN_ID}`)
    expect(result.enabled).toBe(false)
  })

  it('returns disabled for inactive flag', async () => {
    const { token } = await registerUser('inactive', 'ADMIN')

    const createRes = await request(app)
      .post('/api/feature-flags')
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: `test-flag-inactive-${RUN_ID}`,
        name: 'Inactive',
        type: 'BOOLEAN',
        value: { enabled: true },
        active: false,
      })
    createdFlagIds.push(createRes.body.data.flag.id)

    const result = await flagService.evaluateFlag(`test-flag-inactive-${RUN_ID}`)
    expect(result.enabled).toBe(false)
    expect(result.reason).toBe('FLAG_NOT_FOUND_OR_INACTIVE')
  })
})
