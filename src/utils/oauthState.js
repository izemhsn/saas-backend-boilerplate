import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

// Stateless, self-verifying `state` token for the Google OAuth login-CSRF
// defense (H4 in AUDIT.md). `GET /api/auth/google` issues one and embeds it
// in the authorization URL; `POST /api/auth/google` requires the client to
// echo it back and rejects the exchange if it's missing, tampered with, or
// expired — before any call to Google.
//
// Deliberately stateless (HMAC-signed, no DB/Redis row) rather than a
// persisted single-use token: it needs no migration, adds no dependency to a
// code path that previously had none, and degrades the same way the rest of
// the app's JWTs do. The tradeoff is no single-use enforcement — a captured
// state is replayable until it expires. That's an acceptable bound given the
// short TTL; genuine single-use would need a store, which is a larger change
// than this fix warrants.
const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

const getSecret = () => {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET must be set to create an OAuth state token')
  return secret
}

const sign = (payload) => createHmac('sha256', getSecret()).update(payload).digest('hex')

export const createOAuthState = () => {
  const nonce = randomBytes(16).toString('hex')
  const expiresAt = Date.now() + STATE_TTL_MS
  const payload = `${nonce}.${expiresAt}`
  return `${payload}.${sign(payload)}`
}

export const verifyOAuthState = (state) => {
  if (typeof state !== 'string') return false

  const parts = state.split('.')
  if (parts.length !== 3) return false
  const [nonce, expiresAtRaw, signature] = parts

  const payload = `${nonce}.${expiresAtRaw}`
  const expectedSignature = sign(payload)

  // Compare the raw hex strings (as UTF-8 bytes), not Buffer.from(str, 'hex')
  // output — Buffer.from silently stops at the first invalid hex character
  // and returns whatever it parsed up to that point instead of throwing, so
  // a tampered signature with trailing garbage (e.g. one extra character)
  // would parse down to the same valid byte length as the real one and pass
  // a length-then-timingSafeEqual check on the decoded bytes.
  const provided = Buffer.from(signature, 'utf8')
  const expected = Buffer.from(expectedSignature, 'utf8')
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return false
  }

  const expiresAt = Number(expiresAtRaw)
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false

  return true
}
