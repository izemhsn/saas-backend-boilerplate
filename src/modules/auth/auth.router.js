import { Router } from 'express'
import { validate } from '../../middleware/validate.middleware.js'
import { authenticate } from '../../middleware/auth.middleware.js'
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  changeEmailSchema,
  logoutSchema,
  googleLoginSchema,
} from './auth.schema.js'
import * as ctrl from './auth.controller.js'

const router = Router()

// Public routes
router.post('/register', validate(registerSchema), ctrl.register)
router.post('/login', validate(loginSchema), ctrl.login)
router.post('/refresh', validate(refreshSchema), ctrl.refresh)
router.post('/verify-email', validate(verifyEmailSchema), ctrl.verifyEmail)
router.post('/resend-verification', validate(resendVerificationSchema), ctrl.resendVerification)
router.post('/forgot-password', validate(forgotPasswordSchema), ctrl.forgotPassword)
router.post('/reset-password', validate(resetPasswordSchema), ctrl.resetPassword)

// Google OAuth routes
router.get('/google', ctrl.googleAuthUrl)
router.post('/google', validate(googleLoginSchema), ctrl.googleLogin)

// Protected route — JWT required
router.post('/change-password', authenticate, validate(changePasswordSchema), ctrl.changePassword)
router.post('/change-email', authenticate, validate(changeEmailSchema), ctrl.changeEmail)
router.post('/logout', authenticate, validate(logoutSchema), ctrl.logout)
router.get('/me', authenticate, ctrl.getMe)

export default router
