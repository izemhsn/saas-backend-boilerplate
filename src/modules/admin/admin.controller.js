import * as adminService from './admin.service.js'
import { log as auditLog } from '../audit/audit.service.js'

export const listUsers = async (req, res, next) => {
  try {
    const data = await adminService.listUsers(req.validated.query)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const getUser = async (req, res, next) => {
  try {
    const data = await adminService.getUser(req.validated.params.userId)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const updateUser = async (req, res, next) => {
  try {
    const data = await adminService.updateUser(req.validated.params.userId, req.validated.body)
    const body = req.validated.body
    if (body.banned === true) {
      auditLog('USER_BANNED', { userId: req.user.id, targetUserId: req.validated.params.userId, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    } else if (body.banned === false) {
      auditLog('USER_UNBANNED', { userId: req.user.id, targetUserId: req.validated.params.userId, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    }
    if (body.suspendedUntil !== undefined) {
      if (body.suspendedUntil) {
        auditLog('USER_SUSPENDED', { userId: req.user.id, targetUserId: req.validated.params.userId, metadata: { until: body.suspendedUntil }, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
      } else {
        auditLog('USER_UNSUSPENDED', { userId: req.user.id, targetUserId: req.validated.params.userId, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
      }
    }
    if (body.role !== undefined) {
      auditLog('USER_ROLE_CHANGED', { userId: req.user.id, targetUserId: req.validated.params.userId, metadata: { newRole: body.role }, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    }
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const deleteUser = async (req, res, next) => {
  try {
    const data = await adminService.deleteUser(req.validated.params.userId)
    auditLog('USER_DELETED', { userId: req.user.id, targetUserId: req.validated.params.userId, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}
