import { randomBytes, createHash } from 'crypto'
import { prisma } from '../../config/db.js'
import { httpError } from '../../utils/httpError.js'
import { paginationParams, paginationMeta, parseSort, buildSearch } from '../../utils/query.js'

const KEY_PREFIX = 'sk_'
const KEY_BYTES = 32

// `lastUsedAt` is a "last seen" timestamp for humans reading the key list —
// nothing authorizes off it. Writing it on literally every authenticated
// request turned every API read into a read plus a write; refreshing it at
// most once a minute per key keeps the display useful while cutting that
// write volume by orders of magnitude on any busy integration.
const LAST_USED_REFRESH_MS = 60 * 1000

const keySelect = {
  id: true,
  name: true,
  keyPrefix: true,
  scopes: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
}

const hashKey = (key) => createHash('sha256').update(key).digest('hex')

export const generateRawKey = () => {
  const bytes = randomBytes(KEY_BYTES)
  const hex = bytes.toString('hex')
  return `${KEY_PREFIX}${hex}`
}

export const createApiKey = async (userId, { name, scopes = [], expiresAt = null }) => {
  const rawKey = generateRawKey()
  const keyHash = hashKey(rawKey)
  const keyPrefix = rawKey.slice(0, 10)

  const apiKey = await prisma.apiKey.create({
    data: {
      name,
      keyHash,
      keyPrefix,
      userId,
      scopes,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
    select: keySelect,
  })

  return { apiKey, key: rawKey }
}

export const listApiKeys = async (userId, query = {}) => {
  const { page, limit, search, sort, order } = query

  const where = { userId, revokedAt: null, deletedAt: null }

  const searchClause = buildSearch(search, ['name', 'keyPrefix'])
  if (searchClause) where.OR = searchClause

  const [apiKeys, total] = await Promise.all([
    prisma.apiKey.findMany({
      where,
      select: keySelect,
      orderBy: parseSort(sort, order, ['createdAt', 'name', 'lastUsedAt']),
      ...paginationParams(page, limit),
    }),
    prisma.apiKey.count({ where }),
  ])

  return {
    apiKeys,
    pagination: paginationMeta(page, limit, total),
  }
}

export const getApiKey = async (userId, keyId) => {
  const apiKey = await prisma.apiKey.findFirst({
    where: { id: keyId, userId, deletedAt: null },
    select: keySelect,
  })
  if (!apiKey) throw httpError('errors.apiKeyNotFound', 404)

  return { apiKey }
}

export const revokeApiKey = async (userId, keyId) => {
  const apiKey = await prisma.apiKey.findFirst({
    where: { id: keyId, userId, revokedAt: null, deletedAt: null },
    select: { id: true },
  })
  if (!apiKey) throw httpError('errors.apiKeyNotFoundOrRevoked', 404)

  const revoked = await prisma.apiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
    select: keySelect,
  })

  return { apiKey: revoked }
}

export const deleteApiKey = async (userId, keyId) => {
  const apiKey = await prisma.apiKey.findFirst({
    where: { id: keyId, userId, deletedAt: null },
    select: { id: true },
  })
  if (!apiKey) throw httpError('errors.apiKeyNotFound', 404)

  await prisma.apiKey.update({ where: { id: keyId }, data: { deletedAt: new Date() } })
  return { messageKey: 'messages.apiKeyDeletedSuccessfully' }
}

export const restoreApiKey = async (userId, keyId) => {
  const apiKey = await prisma.apiKey.findFirst({
    where: { id: keyId, userId, deletedAt: { not: null } },
    select: { id: true },
  })
  if (!apiKey) throw httpError('errors.deletedApiKeyNotFound', 404)

  const restored = await prisma.apiKey.update({
    where: { id: keyId },
    data: { deletedAt: null },
    select: keySelect,
  })

  return { apiKey: restored }
}

export const verifyApiKey = async (rawKey) => {
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) {
    return null
  }

  const keyHash = hashKey(rawKey)

  const apiKey = await prisma.apiKey.findFirst({
    where: { keyHash, deletedAt: null },
    select: {
      id: true,
      userId: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          banned: true,
          suspendedUntil: true,
          deletedAt: true,
        },
      },
    },
  })

  if (!apiKey) return null
  if (apiKey.revokedAt) return null
  if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) return null
  if (apiKey.user.banned) return null
  if (apiKey.user.deletedAt) return null
  if (apiKey.user.suspendedUntil && apiKey.user.suspendedUntil > new Date()) return null

  // Refresh lastUsedAt at most once per LAST_USED_REFRESH_MS (fire-and-forget,
  // never blocks the request). With several API replicas each keeps its own
  // view of the row it just read, so the worst case is one write per replica
  // per window instead of one per request — still a reduction of orders of
  // magnitude, and this column carries no authorization meaning.
  const stale =
    !apiKey.lastUsedAt || Date.now() - apiKey.lastUsedAt.getTime() >= LAST_USED_REFRESH_MS
  if (stale) {
    prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {})
  }

  return {
    id: apiKey.id,
    userId: apiKey.userId,
    scopes: apiKey.scopes,
    user: apiKey.user,
  }
}
