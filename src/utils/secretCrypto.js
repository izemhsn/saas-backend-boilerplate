import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

// AES-256-GCM encryption for application secrets at rest (e.g. TOTP secrets).
//
// Key source: SECRET_ENCRYPTION_KEY if set (recommended — allows key rotation
// independent of JWT_SECRET), otherwise derived from JWT_SECRET so encryption
// is always on without extra configuration. Either value is hashed to a
// 32-byte key with SHA-256.
//
// Format: "enc:v1:" + base64(iv[12] + authTag[16] + ciphertext). Values
// without the prefix are treated as legacy plaintext so existing rows keep
// working; they are re-encrypted the next time they are written.
const PREFIX = 'enc:v1:'
const IV_LENGTH = 12
const TAG_LENGTH = 16

const getKey = () => {
  const source = process.env.SECRET_ENCRYPTION_KEY || process.env.JWT_SECRET
  if (!source) throw new Error('SECRET_ENCRYPTION_KEY or JWT_SECRET must be set to encrypt secrets')
  return createHash('sha256').update(String(source)).digest()
}

export const encryptSecret = (plaintext) => {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64')}`
}

export const decryptSecret = (stored) => {
  if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return stored // legacy plaintext
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64')
  const iv = raw.subarray(0, IV_LENGTH)
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH)
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
