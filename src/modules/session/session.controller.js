import * as sessionService from './session.service.js'

export const listSessions = async (req, res, next) => {
  try {
    const data = await sessionService.listSessions(req.user.id, req.validated?.query)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const revokeSession = async (req, res, next) => {
  try {
    const data = await sessionService.revokeSession(req.user.id, req.validated.params.sessionId)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const revokeAllSessions = async (req, res, next) => {
  try {
    const data = await sessionService.revokeAllSessions(req.user.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}
