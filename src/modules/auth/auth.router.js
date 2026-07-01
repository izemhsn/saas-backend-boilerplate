import { Router }     from 'express'
import { validate }     from '../../middleware/validate.middleware.js'
import { authenticate } from '../../middleware/auth.middleware.js'
import { registerSchema, loginSchema, refreshSchema, verifyEmailSchema, changePasswordSchema, changeEmailSchema } from './auth.schema.js'
import * as ctrl from './auth.controller.js'

const router = Router()

// Public routes
router.post('/register', validate(registerSchema), ctrl.register)
router.post('/login',    validate(loginSchema),    ctrl.login)
router.post('/refresh',  validate(refreshSchema), ctrl.refresh)
router.post('/verify-email', validate(verifyEmailSchema), ctrl.verifyEmail)


// Protected route — JWT required
router.post('/change-password', authenticate, validate(changePasswordSchema), ctrl.changePassword)
router.post('/change-email', authenticate, validate(changeEmailSchema), ctrl.changeEmail)
router.post('/logout',   authenticate, ctrl.logout)
router.get('/me', authenticate, ctrl.getMe)

export default router