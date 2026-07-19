import * as orgService from './org.service.js'
import { log as auditLog } from '../audit/audit.service.js'

export const createOrganization = async (req, res, next) => {
  try {
    const data = await orgService.createOrganization(req.user.id, req.validated.body)
    auditLog('ORG_CREATED', { userId: req.user.id, organizationId: data.organization.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const listOrganizations = async (req, res, next) => {
  try {
    const data = await orgService.listOrganizations(req.user.id, req.validated?.query)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const getOrganization = async (req, res, next) => {
  try {
    const data = await orgService.getOrganization(req.tenant.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const updateOrganization = async (req, res, next) => {
  try {
    const data = await orgService.updateOrganization(req.tenant.id, req.validated.body)
    auditLog('ORG_UPDATED', { userId: req.user.id, organizationId: req.tenant.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const deleteOrganization = async (req, res, next) => {
  try {
    const data = await orgService.deleteOrganization(req.tenant.id)
    auditLog('ORG_DELETED', { userId: req.user.id, organizationId: req.tenant.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const listMembers = async (req, res, next) => {
  try {
    const data = await orgService.listMembers(req.tenant.id, req.validated?.query)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const updateMemberRole = async (req, res, next) => {
  try {
    const data = await orgService.updateMemberRole(
      req.tenant.id,
      req.validated.params.userId,
      req.validated.body.role,
    )
    auditLog('MEMBER_ROLE_CHANGED', { userId: req.user.id, targetUserId: req.validated.params.userId, organizationId: req.tenant.id, metadata: { newRole: req.validated.body.role }, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const removeMember = async (req, res, next) => {
  try {
    const data = await orgService.removeMember(req.tenant.id, req.validated.params.userId)
    auditLog('MEMBER_REMOVED', { userId: req.user.id, targetUserId: req.validated.params.userId, organizationId: req.tenant.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}
