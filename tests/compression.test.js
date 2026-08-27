import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'

// L4: compression's default 1KB threshold was overridden to 0 (compress
// everything), which is pointless below the MTU and BREACH-adjacent. The
// fix restored the default, so these tests now exercise it against
// GET /api/docs — the full OpenAPI spec, comfortably over 1KB — rather than
// GET /health, whose tiny body is exactly the kind of response that should
// no longer be compressed.
describe('Compression middleware', () => {
  it('compresses a response over the threshold when Accept-Encoding includes gzip', async () => {
    const res = await request(app).get('/api/docs').set('Accept-Encoding', 'gzip')

    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBe('gzip')
  })

  it('does not compress when client requests identity encoding', async () => {
    const res = await request(app).get('/api/docs').set('Accept-Encoding', 'identity')

    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBeUndefined()
  })

  it('compresses JSON API responses', async () => {
    const res = await request(app).get('/api/docs').set('Accept-Encoding', 'gzip')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/json/)
    expect(res.headers['content-encoding']).toBe('gzip')
    expect(res.headers['vary'].toLowerCase()).toContain('accept-encoding')
  })

  it('sets Vary: Accept-Encoding header', async () => {
    const res = await request(app).get('/api/docs').set('Accept-Encoding', 'gzip')

    expect(res.status).toBe(200)
    expect(res.headers['vary'].toLowerCase()).toContain('accept-encoding')
  })

  it('does not compress a small response even when the client accepts gzip', async () => {
    const res = await request(app).get('/health').set('Accept-Encoding', 'gzip')

    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBeUndefined()
  })
})
