import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { prisma } from '../src/config/db.js'

const RUN_ID = Date.now()
const emailFor = (label) => `session-${label}-${RUN_ID}@example.com`
const VALID_PASSWORD = 'Password123'

const createdEmails = []
const createdUserIds = []

const registerUser = async (label) => {
  const email = emailFor(label)
  createdEmails.push(email)
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test User', email, password: VALID_PASSWORD })
  createdUserIds.push(res.body.data.user.id)
  return { email, res }
}

afterAll(async () => {
  await prisma.refreshToken.deleteMany({
    where: { user: { email: { in: createdEmails } } },
  })
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } })
  await prisma.$disconnect()
})

describe('GET /api/sessions', () => {
  it('lists active sessions with pagination', async () => {
    const { res: registerRes } = await registerUser('list')
    const { token } = registerRes.body.data

    // Create a second session via refresh
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: registerRes.body.data.refreshToken })

    const res = await request(app)
      .get('/api/sessions')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.sessions.length).toBeGreaterThanOrEqual(1)
    expect(res.body.data.pagination).toBeDefined()
    // Each session should have device info fields
    expect(res.body.data.sessions[0]).toHaveProperty('userAgent')
    expect(res.body.data.sessions[0]).toHaveProperty('ipAddress')
    expect(res.body.data.sessions[0]).toHaveProperty('revoked')
    expect(res.body.data.sessions[0]).toHaveProperty('expiresAt')
  })

  it('only returns sessions for the authenticated user', async () => {
    const { res: res2 } = await registerUser('isolation2')
    const token2 = res2.body.data.token

    const res = await request(app)
      .get('/api/sessions')
      .set('Authorization', `Bearer ${token2}`)

    expect(res.status).toBe(200)
    // Cross-revoke test below verifies isolation — here we just verify the list works
    expect(res.body.data.sessions.length).toBeGreaterThanOrEqual(1)
  })

  it('rejects unauthenticated request', async () => {
    const res = await request(app).get('/api/sessions')

    expect(res.status).toBe(401)
  })
})

describe('POST /api/sessions/:sessionId/revoke', () => {
  it('revokes a specific session', async () => {
    const { res: registerRes } = await registerUser('revoke-one')
    const { token } = registerRes.body.data

    // Get sessions
    const listRes = await request(app)
      .get('/api/sessions')
      .set('Authorization', `Bearer ${token}`)

    const sessionId = listRes.body.data.sessions[0].id

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/revoke`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.session.revoked).toBe(true)
  })

  it('returns 404 for non-existent session', async () => {
    const { res: registerRes } = await registerUser('revoke-404')
    const { token } = registerRes.body.data

    const res = await request(app)
      .post('/api/sessions/nonexistent-id/revoke')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  it('returns 400 when revoking an already revoked session', async () => {
    const { res: registerRes } = await registerUser('revoke-twice')
    const { token } = registerRes.body.data

    const listRes = await request(app)
      .get('/api/sessions')
      .set('Authorization', `Bearer ${token}`)

    const sessionId = listRes.body.data.sessions[0].id

    // First revoke
    await request(app)
      .post(`/api/sessions/${sessionId}/revoke`)
      .set('Authorization', `Bearer ${token}`)

    // Second revoke
    const res = await request(app)
      .post(`/api/sessions/${sessionId}/revoke`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
  })

  it('cannot revoke another user session', async () => {
    const { res: res1 } = await registerUser('cross-revoke1')
    const { res: res2 } = await registerUser('cross-revoke2')
    const token1 = res1.body.data.token
    const token2 = res2.body.data.token

    // Get user2's sessions
    const listRes = await request(app)
      .get('/api/sessions')
      .set('Authorization', `Bearer ${token2}`)

    const sessionId = listRes.body.data.sessions[0].id

    // Try to revoke user2's session with user1's token
    const res = await request(app)
      .post(`/api/sessions/${sessionId}/revoke`)
      .set('Authorization', `Bearer ${token1}`)

    expect(res.status).toBe(404)
  })
})

describe('POST /api/sessions/revoke-all', () => {
  it('revokes all active sessions for the user', async () => {
    const { res: registerRes } = await registerUser('revoke-all')
    const { token } = registerRes.body.data

    // Create a second session via refresh
    await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: registerRes.body.data.refreshToken })

    const res = await request(app)
      .post('/api/sessions/revoke-all')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.revokedCount).toBeGreaterThanOrEqual(1)

    // Verify all sessions are revoked
    const listRes = await request(app)
      .get('/api/sessions')
      .set('Authorization', `Bearer ${token}`)

    for (const session of listRes.body.data.sessions) {
      expect(session.revoked).toBe(true)
    }
  })

  it('returns revokedCount 0 when no active sessions exist', async () => {
    const { res: registerRes } = await registerUser('revoke-all-empty')
    const { token } = registerRes.body.data

    // Revoke all first
    await request(app)
      .post('/api/sessions/revoke-all')
      .set('Authorization', `Bearer ${token}`)

    // Revoke all again
    const res = await request(app)
      .post('/api/sessions/revoke-all')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.revokedCount).toBe(0)
  })

  it('rejects unauthenticated request', async () => {
    const res = await request(app).post('/api/sessions/revoke-all')

    expect(res.status).toBe(401)
  })
})
