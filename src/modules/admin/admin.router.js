import { Router } from 'express'
import { validate } from '../../middleware/validate.middleware.js'
import { authenticate, authorize } from '../../middleware/auth.middleware.js'
import { listUsersSchema, userIdParamSchema, updateUserSchema } from './admin.schema.js'
import * as ctrl from './admin.controller.js'

const router = Router()

// All admin routes require authentication + ADMIN role
router.use(authenticate, authorize('ADMIN'))

router.get('/users', validate(listUsersSchema), ctrl.listUsers)
router.get('/users/:userId', validate(userIdParamSchema), ctrl.getUser)
router.patch('/users/:userId', validate(updateUserSchema), ctrl.updateUser)
router.delete('/users/:userId', validate(userIdParamSchema), ctrl.deleteUser)

export default router
