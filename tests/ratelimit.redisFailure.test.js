import { describe, it, expect, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import rateLimit from 'express-rate-limit'
import { RedisStore } from 'rate-limit-redis'
import IORedis from 'ioredis'

// Regression test for the C2 audit finding: a Redis outage used to hang every
// rate-limited request for ~11-20s (the shared BullMQ connection's
// maxRetriesPerRequest: null + 10-retry backoff) and could tear down the
// whole process via an unhandledRejection once the command queue was
// flushed. The fix is a dedicated, fail-fast connection for the rate limiter
// (maxRetriesPerRequest: 1 + a short commandTimeout — see
// config/redis.js#getRateLimitRedisConnection) combined with
// express-rate-limit's `passOnStoreError: true`, so requests fail OPEN
// quickly instead of hanging or crashing.
//
// This is exercised against a throwaway app (rather than the real app),
// because the real app disables its rate limiters entirely under
// NODE_ENV=test — this test targets the Redis-failure-handling mechanism
// itself: the same store/connection/option combination app.js wires up.
describe('Rate limiter Redis failure handling', () => {
  // Nothing listens on this port — simulates Redis being unreachable.
  const deadConnection = new IORedis('redis://127.0.0.1:16379', {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    commandTimeout: 1000,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  })
  deadConnection.on('error', () => {}) // expected — Redis is intentionally down for this test

  afterAll(() => {
    deadConnection.disconnect()
  })

  const buildApp = () => {
    const app = express()
    const store = new RedisStore({
      prefix: 'rl:test:',
      sendCommand: (...args) => deadConnection.call(...args),
    })
    // RedisStore fires SCRIPT LOAD commands in its constructor without
    // awaiting them — see the matching guard (and its rationale) in
    // app.js#createRedisStore. Without this, a Redis outage at process
    // startup can reject these before any request exists to await them,
    // which Node reports as a genuine unhandledRejection.
    store.incrementScriptSha?.catch(() => {})
    store.getScriptSha?.catch(() => {})
    const limiter = rateLimit({
      windowMs: 1000,
      limit: 1,
      passOnStoreError: true,
      store,
    })
    app.get('/ping', limiter, (req, res) => res.json({ ok: true }))
    return app
  }

  it('lets the request through quickly instead of hanging or erroring when Redis is unreachable', async () => {
    const app = buildApp()
    const start = Date.now()
    const res = await request(app).get('/ping')
    const elapsed = Date.now() - start

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    // Was ~11-20s before the fix; the fail-fast connection settles this in
    // well under a second in practice — 5s leaves headroom for slow CI.
    expect(elapsed).toBeLessThan(5000)
  }, 10000)

  it('keeps failing open on repeated requests, not just the first', async () => {
    const app = buildApp()
    const first = await request(app).get('/ping')
    const second = await request(app).get('/ping')

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
  }, 10000)

  it('never raises an unhandledRejection even when no request arrives before Redis fails', async () => {
    // Reproduces server startup: the store is constructed (firing its
    // internal SCRIPT LOAD commands) but nothing awaits them for a while —
    // exactly the gap that let a Redis outage crash the whole process before
    // this guard existed.
    const seen = []
    const onUnhandled = (reason) => seen.push(reason)
    process.on('unhandledRejection', onUnhandled)

    try {
      buildApp() // constructs the store; intentionally not sending any request
      // Outlive the connection's own fail-fast window (~1s) so the SCRIPT
      // LOAD promises have definitely settled with nothing having awaited them yet.
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(seen).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  }, 10000)
})
