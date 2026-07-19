import { randomBytes, createHash } from 'crypto'
import { prisma } from '../../config/db.js'
import { httpError } from '../../utils/httpError.js'
import { paginationParams, paginationMeta, parseSort, buildSearch } from '../../utils/query.js'

const KEY_PREFIX = 'sk_'
const KEY_BYTES = 32

const keySelect = {
  id: true,
  name: true,
  keyPrefix: true,
  scopes: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
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

  const where = { userId, revokedAt: null }

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
    where: { id: keyId, userId },
    select: keySelect,
  })
  if (!apiKey) throw httpError('API key not found', 404)

  return { apiKey }
}

export const revokeApiKey = async (userId, keyId) => {
  const apiKey = await prisma.apiKey.findFirst({
    where: { id: keyId, userId, revokedAt: null },
    select: { id: true },
  })
  if (!apiKey) throw httpError('API key not found or already revoked', 404)

  const revoked = await prisma.apiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
    select: keySelect,
  })

  return { apiKey: revoked }
}

export const deleteApiKey = async (userId, keyId) => {
  const apiKey = await prisma.apiKey.findFirst({
    where: { id: keyId, userId },
    select: { id: true },
  })
  if (!apiKey) throw httpError('API key not found', 404)

  await prisma.apiKey.delete({ where: { id: keyId } })
  return { message: 'API key deleted successfully' }
}

export const verifyApiKey = async (rawKey) => {
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) {
    return null
  }

  const keyHash = hashKey(rawKey)

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
    select: {
      id: true,
      userId: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
      user: {
        select: { id: true, email: true, role: true, banned: true, suspendedUntil: true },
      },
    },
  })

  if (!apiKey) return null
  if (apiKey.revokedAt) return null
  if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) return null
  if (apiKey.user.banned) return null
  if (apiKey.user.suspendedUntil && apiKey.user.suspendedUntil > new Date()) return null

  // Update lastUsedAt (fire-and-forget, don't block the request)
  prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {})

  return {
    id: apiKey.id,
    userId: apiKey.userId,
    scopes: apiKey.scopes,
    user: apiKey.user,
  }
}
