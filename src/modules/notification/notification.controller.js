import * as notificationService from './notification.service.js'

export const listNotifications = async (req, res, next) => {
  try {
    const data = await notificationService.listNotifications(req.user.id, req.validated?.query)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const markAsRead = async (req, res, next) => {
  try {
    const data = await notificationService.markAsRead(
      req.user.id,
      req.validated.params.notificationId,
    )
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const markAllAsRead = async (req, res, next) => {
  try {
    const data = await notificationService.markAllAsRead(req.user.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const deleteNotification = async (req, res, next) => {
  try {
    const data = await notificationService.deleteNotification(
      req.user.id,
      req.validated.params.notificationId,
    )
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const getPreferences = async (req, res, next) => {
  try {
    const data = await notificationService.getPreferences(req.user.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const updatePreferences = async (req, res, next) => {
  try {
    const data = await notificationService.updatePreferences(req.user.id, req.validated.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}
