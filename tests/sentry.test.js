import { describe, it, expect, vi, afterEach } from 'vitest'
import { initSentry, getSentry } from '../src/config/sentry.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Sentry config', () => {
  it('returns false when SENTRY_DSN is not set', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SENTRY_DSN', '')
    const result = initSentry()
    expect(result).toBe(false)
    expect(getSentry()).toBeNull()
  })

  it('returns false in test environment even with DSN', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('SENTRY_DSN', 'https://example@sentry.io/123')
    const result = initSentry()
    expect(result).toBe(false)
    expect(getSentry()).toBeNull()
  })

  it('initializes when SENTRY_DSN is set and not in test', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SENTRY_DSN', 'https://example@sentry.io/123')
    const result = initSentry()
    expect(result).toBe(true)
    const sentry = getSentry()
    expect(sentry).toBeTruthy()
    expect(typeof sentry.captureException).toBe('function')
  })
})
