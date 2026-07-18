import * as adminService from './admin.service.js'

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
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const deleteUser = async (req, res, next) => {
  try {
    const data = await adminService.deleteUser(req.validated.params.userId)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}
