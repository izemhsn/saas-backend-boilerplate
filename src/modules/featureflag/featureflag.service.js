import { prisma } from '../../config/db.js'
import { httpError } from '../../utils/httpError.js'
import { paginationParams, paginationMeta, parseSort, buildSearch } from '../../utils/query.js'

const flagSelect = {
  id: true,
  key: true,
  name: true,
  description: true,
  type: true,
  value: true,
  active: true,
  createdAt: true,
  updatedAt: true,
}

// ── Admin CRUD ──────────────────────────────────────────────────────

export const createFlag = async ({ key, name, description, type, value, active }) => {
  const existing = await prisma.featureFlag.findUnique({ where: { key }, select: { id: true } })
  if (existing) throw httpError('errors.flagKeyAlreadyExists', 409)

  const flag = await prisma.featureFlag.create({
    data: { key, name, description, type, value, active },
    select: flagSelect,
  })

  return { flag }
}

export const listFlags = async (query = {}) => {
  const { page, limit, search, sort, order, type, active } = query

  const where = {}
  if (type) where.type = type
  if (active !== undefined) where.active = active === 'true'

  const searchClause = buildSearch(search, ['name', 'key', 'description'])
  if (searchClause) where.OR = searchClause

  const [flags, total] = await Promise.all([
    prisma.featureFlag.findMany({
      where,
      select: flagSelect,
      orderBy: parseSort(sort, order, ['createdAt', 'name', 'key', 'type']),
      ...paginationParams(page, limit),
    }),
    prisma.featureFlag.count({ where }),
  ])

  return {
    flags,
    pagination: paginationMeta(page, limit, total),
  }
}

export const getFlag = async (flagId) => {
  const flag = await prisma.featureFlag.findUnique({
    where: { id: flagId },
    select: {
      ...flagSelect,
      overrides: {
        select: {
          id: true,
          organizationId: true,
          enabled: true,
          value: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  })
  if (!flag) throw httpError('errors.featureFlagNotFound', 404)
  return { flag }
}

export const updateFlag = async (flagId, data) => {
  const flag = await prisma.featureFlag.findUnique({ where: { id: flagId }, select: { id: true } })
  if (!flag) throw httpError('errors.featureFlagNotFound', 404)

  const updated = await prisma.featureFlag.update({
    where: { id: flagId },
    data,
    select: flagSelect,
  })

  return { flag: updated }
}

export const deleteFlag = async (flagId) => {
  const flag = await prisma.featureFlag.findUnique({ where: { id: flagId }, select: { id: true } })
  if (!flag) throw httpError('errors.featureFlagNotFound', 404)

  await prisma.featureFlag.delete({ where: { id: flagId } })
  return { messageKey: 'messages.featureFlagDeletedSuccessfully' }
}

// ── Organization Overrides ──────────────────────────────────────────

export const setOverride = async (flagId, orgId, { enabled, value }) => {
  const flag = await prisma.featureFlag.findUnique({ where: { id: flagId }, select: { id: true } })
  if (!flag) throw httpError('errors.featureFlagNotFound', 404)

  const org = await prisma.organization.findFirst({
    where: { id: orgId, deletedAt: null },
    select: { id: true },
  })
  if (!org) throw httpError('errors.organizationNotFoundForFlag', 404)

  const override = await prisma.organizationFeatureFlag.upsert({
    where: { featureFlagId_organizationId: { featureFlagId: flagId, organizationId: orgId } },
    create: { featureFlagId: flagId, organizationId: orgId, enabled, value },
    update: { enabled, value },
    select: {
      id: true,
      featureFlagId: true,
      organizationId: true,
      enabled: true,
      value: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return { override }
}

export const removeOverride = async (flagId, orgId) => {
  const override = await prisma.organizationFeatureFlag.findUnique({
    where: { featureFlagId_organizationId: { featureFlagId: flagId, organizationId: orgId } },
    select: { id: true },
  })
  if (!override) throw httpError('errors.overrideNotFound', 404)

  await prisma.organizationFeatureFlag.delete({ where: { id: override.id } })
  return { messageKey: 'messages.overrideRemovedSuccessfully' }
}

// ── Evaluation ──────────────────────────────────────────────────────

export const evaluateFlag = async (key, orgId = null, planName = null) => {
  const flag = await prisma.featureFlag.findUnique({
    where: { key },
    select: { id: true, type: true, value: true, active: true },
  })

  if (!flag || !flag.active) {
    return { key, enabled: false, reason: 'FLAG_NOT_FOUND_OR_INACTIVE' }
  }

  // Check org override first
  if (orgId) {
    const override = await prisma.organizationFeatureFlag.findUnique({
      where: { featureFlagId_organizationId: { featureFlagId: flag.id, organizationId: orgId } },
      select: { enabled: true, value: true },
    })

    if (override) {
      const result = evaluateByType(flag.type, override.value, override.enabled, planName)
      return { key, ...result, reason: 'OVERRIDE' }
    }
  }

  const result = evaluateByType(flag.type, flag.value, true, planName)
  return { key, ...result, reason: 'DEFAULT' }
}

const evaluateByType = (type, value, enabled, planName) => {
  if (!enabled) return { enabled: false }

  switch (type) {
    case 'BOOLEAN':
      return { enabled: !!value?.enabled }

    case 'PERCENTAGE': {
      const pct = value?.percentage ?? 0
      if (pct <= 0) return { enabled: false }
      if (pct >= 100) return { enabled: true }
      return { enabled: Math.random() * 100 < pct }
    }

    case 'PLAN': {
      const plans = value?.plans ?? []
      if (plans.length === 0) return { enabled: true }
      return { enabled: planName ? plans.includes(planName) : false }
    }

    default:
      return { enabled: false }
  }
}
