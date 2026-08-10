import * as gdprService from './gdpr.service.js'
import { log as auditLog } from '../audit/audit.service.js'
import { translateResult } from '../../utils/i18nResponse.js'

export const exportData = async (req, res, next) => {
  try {
    const data = await gdprService.exportData(req.user.id)
    auditLog('USER_DATA_EXPORTED', {
      userId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const deleteAccount = async (req, res, next) => {
  try {
    const data = await gdprService.deleteAccount(req.user.id, req.validated.body.password)
    // Log without userId — the user has been hard-deleted, so the FK would fail.
    // Store the deleted user's ID in metadata for traceability.
    auditLog('USER_DATA_DELETED', {
      targetUserId: req.user.id,
      metadata: { email: data.email },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}
