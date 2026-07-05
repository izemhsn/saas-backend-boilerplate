import * as authService from './auth.service.js'

export const register = async (req, res, next) => {
  try {
    const data = await authService.register(req.validated.body)
    res.status(201).json({ success: true, data })
  } catch (err) { next(err) }
}

export const login = async (req, res, next) => {
  try {
    const data = await authService.login(req.validated.body)
    res.json({ success: true, data })
  } catch (err) { next(err) }
}

export const refresh = async (req, res, next) => {
  try {
    const data = await authService.refresh(req.validated.body)
    res.json({ success: true, data })
  } catch (err) { next(err) }
}

export const verifyEmail = async (req, res, next) => {
  try {
    const data = await authService.verifyEmail(req.validated.body)
    res.json({ success: true, data })
  } catch (err) { next(err) }
}

export const resendVerification = async (req, res, next) => {
  try {
    const data = await authService.resendVerification(req.validated.body)
    res.json({ success: true, data })
  } catch (err) { next(err) }
}

export const forgotPassword = async (req, res, next) => {
  try {
    const data = await authService.forgotPassword(req.validated.body)
    res.json({ success: true, data })
  } catch (err) { next(err) }
}

export const resetPassword = async (req, res, next) => {
  try {
    const data = await authService.resetPassword(req.validated.body)
    res.json({ success: true, data })
  } catch (err) { next(err) }
}

export const changePassword = async (req, res, next) => {
  try {
    const data = await authService.changePassword(req.user.id, req.validated.body)
    res.json({ success: true, data })
  } catch (err) { next(err) }
}

export const changeEmail = async (req, res, next) => {
  try {
    const data = await authService.changeEmail(req.user.id, req.validated.body)
    res.json({ success: true, data })
  } catch (err) { next(err) }
}

export const logout = async (req, res, next) => {
  try {
    await authService.logout(req.user.id)
    res.json({ success: true, data: { message: 'Logged out successfully' } })
  } catch (err) { next(err) }
}

export const getMe = async (req, res, next) => {
  try {
    const user = await authService.getMe(req.user.id)
    res.json({ success: true, data: { user } })
  } catch (err) { next(err) }
}