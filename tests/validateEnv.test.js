import { describe, it, expect } from 'vitest'
import { validateEnv } from '../src/config/validateEnv.js'

const baseDevEnv = {
  DATABASE_URL: 'postgresql://localhost:5432/db',
  JWT_SECRET: 'short',
  JWT_REFRESH_SECRET: 'also-short',
}

const validSecret = (suffix) => `${suffix}-${'x'.repeat(40)}`

const baseProdEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://prod-host:5432/db',
  JWT_SECRET: validSecret('access'),
  JWT_REFRESH_SECRET: validSecret('refresh'),
  CORS_ORIGIN: 'https://app.example.com',
  APP_URL: 'https://app.example.com',
  SECRET_ENCRYPTION_KEY: validSecret('enc'),
}

describe('validateEnv', () => {
  it('passes for a minimal valid development env', () => {
    expect(validateEnv(baseDevEnv)).toEqual([])
  })

  it('reports every missing required var at once, in dev or prod', () => {
    expect(validateEnv({})).toEqual([
      'Missing required env vars: DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET',
    ])
  })

  it('does not apply production-only checks in development', () => {
    // Short secrets, no CORS_ORIGIN/APP_URL/SECRET_ENCRYPTION_KEY — all fine outside production
    expect(validateEnv(baseDevEnv)).toEqual([])
  })

  it('passes for a fully-configured production env', () => {
    expect(validateEnv(baseProdEnv)).toEqual([])
  })

  it('rejects JWT secrets shorter than 32 characters in production', () => {
    const errors = validateEnv({ ...baseProdEnv, JWT_SECRET: 'too-short' })
    expect(errors).toContain('JWT_SECRET must be at least 32 characters in production')
  })

  it('rejects identical JWT_SECRET and JWT_REFRESH_SECRET in production', () => {
    const secret = validSecret('shared')
    const errors = validateEnv({ ...baseProdEnv, JWT_SECRET: secret, JWT_REFRESH_SECRET: secret })
    expect(errors).toContain('JWT_SECRET and JWT_REFRESH_SECRET must be different in production')
  })

  it('requires CORS_ORIGIN in production', () => {
    const errors = validateEnv({ ...baseProdEnv, CORS_ORIGIN: undefined })
    expect(errors.some((e) => e.includes('CORS_ORIGIN'))).toBe(true)
  })

  it('requires APP_URL in production (M10)', () => {
    const errors = validateEnv({ ...baseProdEnv, APP_URL: undefined })
    expect(errors.some((e) => e.includes('APP_URL'))).toBe(true)
  })

  it('requires SECRET_ENCRYPTION_KEY in production (M9)', () => {
    const errors = validateEnv({ ...baseProdEnv, SECRET_ENCRYPTION_KEY: undefined })
    expect(errors.some((e) => e.includes('SECRET_ENCRYPTION_KEY'))).toBe(true)
  })

  it('reports all production violations together, not just the first', () => {
    const errors = validateEnv({
      NODE_ENV: 'production',
      DATABASE_URL: baseProdEnv.DATABASE_URL,
      JWT_SECRET: 'short',
      JWT_REFRESH_SECRET: 'short',
    })
    expect(errors.length).toBeGreaterThan(1)
  })

  it('stops after reporting missing required vars, without production noise', () => {
    // Missing DATABASE_URL/JWT secrets entirely should not also report the
    // production-only checks that read those same (absent) values.
    const errors = validateEnv({ NODE_ENV: 'production' })
    expect(errors).toEqual([
      'Missing required env vars: DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET',
    ])
  })
})
