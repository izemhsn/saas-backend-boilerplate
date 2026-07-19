import * as auditService from './audit.service.js'

export const listAuditLogs = async (req, res, next) => {
  try {
    const data = await auditService.listAuditLogs(req.validated?.query)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const listMyAuditLogs = async (req, res, next) => {
  try {
    const data = await auditService.listUserAuditLogs(req.user.id, req.validated?.query)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}
