import * as auditService from './audit.service.js'
import { translateResult } from '../../utils/i18nResponse.js'

export const listAuditLogs = async (req, res, next) => {
  try {
    const data = await auditService.listAuditLogs(req.validated?.query)
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const listMyAuditLogs = async (req, res, next) => {
  try {
    const data = await auditService.listUserAuditLogs(req.user.id, req.validated?.query)
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}
