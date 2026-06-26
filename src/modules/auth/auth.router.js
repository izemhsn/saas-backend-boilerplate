import { Router }     from 'express'
import { validate }     from '../../middleware/validate.middleware.js'
import { authenticate } from '../../middleware/auth.middleware.js'
import { registerSchema, loginSchema } from './auth.schema.js'
import * as ctrl from './auth.controller.js'

const router = Router()

// Public routes
router.post('/register', validate(registerSchema), ctrl.register)
router.post('/login',    validate(loginSchema),    ctrl.login)

// Protected route — JWT required
router.get('/me', authenticate, ctrl.getMe)

export default router