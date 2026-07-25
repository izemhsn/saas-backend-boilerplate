import { Router } from 'express'
import { validate } from '../../middleware/validate.middleware.js'
import { authenticate } from '../../middleware/auth.middleware.js'
import {
  listNotificationsSchema,
  notificationIdSchema,
  updatePreferencesSchema,
} from './notification.schema.js'
import * as ctrl from './notification.controller.js'

const router = Router()

// All notification routes require authentication
router.use(authenticate)

// Notifications
router.get('/', validate(listNotificationsSchema), ctrl.listNotifications)
router.patch('/read-all', ctrl.markAllAsRead)
router.patch('/:notificationId/read', validate(notificationIdSchema), ctrl.markAsRead)
router.delete('/:notificationId', validate(notificationIdSchema), ctrl.deleteNotification)

// Preferences
router.get('/preferences', ctrl.getPreferences)
router.patch('/preferences', validate(updatePreferencesSchema), ctrl.updatePreferences)

export default router
