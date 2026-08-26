const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET']

// Pure function of an env object (rather than reading process.env directly)
// so boot validation is unit-testable without spawning a process. Returns an
// array of human-readable problems; an empty array means the env is bootable.
export const validateEnv = (env) => {
  const errors = []

  const missing = REQUIRED_ENV.filter((key) => !env[key])
  if (missing.length) {
    errors.push(`Missing required env vars: ${missing.join(', ')}`)
    // The checks below assume these are present — bail out rather than
    // compound the report with confusing follow-on errors.
    return errors
  }

  if (env.NODE_ENV === 'production') {
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
      if (env[key].length < 32) {
        errors.push(`${key} must be at least 32 characters in production`)
      }
    }
    if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
      errors.push('JWT_SECRET and JWT_REFRESH_SECRET must be different in production')
    }
    if (!env.CORS_ORIGIN) {
      errors.push('CORS_ORIGIN must be set in production')
    }
    // Emailed verification/reset/invitation links are built from APP_URL
    // (email.service.js); an unset value silently defaults to
    // http://localhost:3000, so every such email points nowhere for real
    // users (M10).
    if (!env.APP_URL) {
      errors.push('APP_URL must be set in production (used to build links in emails)')
    }
    // TOTP secrets fall back to encrypting under JWT_SECRET when this is
    // unset (secretCrypto.js). Rotating JWT_SECRET — a routine, recommended
    // action — would then make every stored 2FA secret undecryptable,
    // permanently locking out every 2FA user (M9).
    if (!env.SECRET_ENCRYPTION_KEY) {
      errors.push(
        'SECRET_ENCRYPTION_KEY must be set in production (otherwise 2FA secrets are encrypted ' +
          'under JWT_SECRET, and rotating JWT_SECRET later would lock out every 2FA user)',
      )
    }
  }

  return errors
}
