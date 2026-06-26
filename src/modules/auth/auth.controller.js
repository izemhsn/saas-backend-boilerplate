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

export const getMe = async (req, res, next) => {
  try {
    const user = await authService.getMe(req.user.id)
    res.json({ success: true, data: { user } })
  } catch (err) { next(err) }
}