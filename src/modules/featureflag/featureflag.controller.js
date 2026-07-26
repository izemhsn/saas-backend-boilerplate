import * as flagService from './featureflag.service.js'
import { log as auditLog } from '../audit/audit.service.js'
import { prisma } from '../../config/db.js'

export const createFlag = async (req, res, next) => {
  try {
    const data = await flagService.createFlag(req.validated.body)
    auditLog('FEATURE_FLAG_CREATED', { userId: req.user.id, metadata: { key: req.validated.body.key }, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const listFlags = async (req, res, next) => {
  try {
    const data = await flagService.listFlags(req.validated?.query)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const getFlag = async (req, res, next) => {
  try {
    const data = await flagService.getFlag(req.validated.params.flagId)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const updateFlag = async (req, res, next) => {
  try {
    const data = await flagService.updateFlag(req.validated.params.flagId, req.validated.body)
    auditLog('FEATURE_FLAG_UPDATED', { userId: req.user.id, targetUserId: null, metadata: { flagId: req.validated.params.flagId, changes: req.validated.body }, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const deleteFlag = async (req, res, next) => {
  try {
    const data = await flagService.deleteFlag(req.validated.params.flagId)
    auditLog('FEATURE_FLAG_DELETED', { userId: req.user.id, metadata: { flagId: req.validated.params.flagId }, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const setOverride = async (req, res, next) => {
  try {
    const data = await flagService.setOverride(req.validated.params.flagId, req.validated.params.orgId, req.validated.body)
    auditLog('FEATURE_FLAG_OVERRIDE_SET', { userId: req.user.id, organizationId: req.validated.params.orgId, metadata: { flagId: req.validated.params.flagId, enabled: req.validated.body.enabled }, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const removeOverride = async (req, res, next) => {
  try {
    const data = await flagService.removeOverride(req.validated.params.flagId, req.validated.params.orgId)
    auditLog('FEATURE_FLAG_OVERRIDE_REMOVED', { userId: req.user.id, organizationId: req.validated.params.orgId, metadata: { flagId: req.validated.params.flagId }, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const evaluateFlag = async (req, res, next) => {
  try {
    const { key, orgId } = req.validated.query
    let planName = null

    if (orgId) {
      const sub = await prisma.subscription.findFirst({
        where: { user: { memberships: { some: { organizationId: orgId } } }, status: { in: ['ACTIVE', 'TRIALING'] } },
        select: { plan: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      })
      planName = sub?.plan?.name ?? null
    }

    const data = await flagService.evaluateFlag(key, orgId, planName)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}
