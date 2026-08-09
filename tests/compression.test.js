import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'

describe('Compression middleware', () => {
  it('compresses responses when Accept-Encoding includes gzip', async () => {
    const res = await request(app).get('/health').set('Accept-Encoding', 'gzip')

    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBe('gzip')
  })

  it('does not compress when client requests identity encoding', async () => {
    const res = await request(app).get('/health').set('Accept-Encoding', 'identity')

    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBeUndefined()
  })

  it('compresses JSON API responses', async () => {
    const res = await request(app).get('/health').set('Accept-Encoding', 'gzip')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/json/)
    expect(res.headers['content-encoding']).toBe('gzip')
    expect(res.headers['vary'].toLowerCase()).toContain('accept-encoding')
  })

  it('sets Vary: Accept-Encoding header', async () => {
    const res = await request(app).get('/health').set('Accept-Encoding', 'gzip')

    expect(res.status).toBe(200)
    expect(res.headers['vary'].toLowerCase()).toContain('accept-encoding')
  })
})
