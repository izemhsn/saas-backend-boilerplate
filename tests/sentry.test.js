import { describe, it, expect, vi, afterEach } from 'vitest'
import { getSentry } from '../src/config/sentry.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Sentry config', () => {
  it('returns null when SENTRY_DSN is not set', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SENTRY_DSN', '')
    expect(getSentry()).toBeNull()
  })

  it('returns null in test environment even with DSN', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('SENTRY_DSN', 'https://example@sentry.io/123')
    expect(getSentry()).toBeNull()
  })

  it('returns the Sentry instance when DSN is set and not in test', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SENTRY_DSN', 'https://example@sentry.io/123')
    const sentry = getSentry()
    expect(sentry).toBeTruthy()
    expect(typeof sentry.captureException).toBe('function')
  })
})
