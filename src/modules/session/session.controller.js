import * as sessionService from './session.service.js'
import { translateResult } from '../../utils/i18nResponse.js'
import { log as auditLog } from '../audit/audit.service.js'

export const listSessions = async (req, res, next) => {
  try {
    const data = await sessionService.listSessions(req.user.id, req.validated?.query)
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const revokeSession = async (req, res, next) => {
  try {
    const data = await sessionService.revokeSession(req.user.id, req.validated.params.sessionId)
    auditLog('SESSION_REVOKED', {
      userId: req.user.id,
      metadata: { sessionId: req.validated.params.sessionId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const revokeAllSessions = async (req, res, next) => {
  try {
    const data = await sessionService.revokeAllSessions(req.user.id)
    auditLog('SESSIONS_REVOKED_ALL', {
      userId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}
