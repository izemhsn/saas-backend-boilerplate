import * as authService from './auth.service.js'
import { log as auditLog } from '../audit/audit.service.js'

export const register = async (req, res, next) => {
  try {
    const data = await authService.register(req.validated.body, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    })
    auditLog('USER_REGISTER', {
      userId: data.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const login = async (req, res, next) => {
  try {
    const data = await authService.login(req.validated.body, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    })
    auditLog('USER_LOGIN', {
      userId: data.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const refresh = async (req, res, next) => {
  try {
    const data = await authService.refresh(req.validated.body, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const verifyEmail = async (req, res, next) => {
  try {
    const data = await authService.verifyEmail(req.validated.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const resendVerification = async (req, res, next) => {
  try {
    const data = await authService.resendVerification(req.validated.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const forgotPassword = async (req, res, next) => {
  try {
    const data = await authService.forgotPassword(req.validated.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const resetPassword = async (req, res, next) => {
  try {
    const data = await authService.resetPassword(req.validated.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const changePassword = async (req, res, next) => {
  try {
    const data = await authService.changePassword(req.user.id, req.validated.body)
    auditLog('USER_PASSWORD_CHANGED', {
      userId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const changeEmail = async (req, res, next) => {
  try {
    const data = await authService.changeEmail(req.user.id, req.validated.body)
    auditLog('USER_EMAIL_CHANGED', {
      userId: req.user.id,
      metadata: { newEmail: req.validated.body.newEmail },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const logout = async (req, res, next) => {
  try {
    const refreshToken = req.validated?.body?.refreshToken
    await authService.logout(req.user.id, refreshToken)
    auditLog('USER_LOGOUT', {
      userId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data: { message: 'Logged out successfully' } })
  } catch (err) {
    next(err)
  }
}

export const getMe = async (req, res, next) => {
  try {
    const user = await authService.getMe(req.user.id)
    res.json({ success: true, data: { user } })
  } catch (err) {
    next(err)
  }
}

export const googleAuthUrl = async (req, res, next) => {
  try {
    const data = authService.getGoogleAuthUrl()
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const googleLogin = async (req, res, next) => {
  try {
    const data = await authService.googleLogin(req.validated.body, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    })
    auditLog('USER_OAUTH_LOGIN', {
      userId: data.user.id,
      metadata: { provider: 'google' },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}
