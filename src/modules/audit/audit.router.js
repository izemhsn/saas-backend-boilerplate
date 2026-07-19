import { Router } from 'express'
import { validate } from '../../middleware/validate.middleware.js'
import { authenticate, authorize } from '../../middleware/auth.middleware.js'
import { listAuditLogsSchema, listUserAuditLogsSchema } from './audit.schema.js'
import * as ctrl from './audit.controller.js'

const router = Router()

// Admin — full audit log access with filters
router.get('/', authenticate, authorize('ADMIN'), validate(listAuditLogsSchema), ctrl.listAuditLogs)

// User — own audit history only
router.get('/me', authenticate, validate(listUserAuditLogsSchema), ctrl.listMyAuditLogs)

export default router
