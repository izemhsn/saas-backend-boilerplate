import { Router } from 'express'
import { validate } from '../../middleware/validate.middleware.js'
import { authenticate } from '../../middleware/auth.middleware.js'
import {
  acceptInvitationSchema,
  declineInvitationSchema,
  listMyInvitationsSchema,
} from './invitation.schema.js'
import * as invitationCtrl from './invitation.controller.js'

const router = Router()

// All invitation routes require authentication
router.use(authenticate)

// User-scoped invitation endpoints
router.get('/me', validate(listMyInvitationsSchema), invitationCtrl.listMyInvitations)
router.post('/accept', validate(acceptInvitationSchema), invitationCtrl.acceptInvitation)
router.post('/decline', validate(declineInvitationSchema), invitationCtrl.declineInvitation)

export default router
