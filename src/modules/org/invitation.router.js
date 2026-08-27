import { Router } from 'express'
import { validate } from '../../middleware/validate.middleware.js'
import { authenticate, requireVerifiedEmail } from '../../middleware/auth.middleware.js'
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
// M14: listMyInvitations matches on inviteeEmail alone, with no proof the
// requester actually owns that mailbox. Before the invitee has verified their
// email, an attacker who merely registers that address first could otherwise
// learn the org name, slug, role, and inviter identity for a pending invite
// that isn't theirs yet. requireVerifiedEmail closes that — accept/decline
// don't need it, since both require the emailed token, not just the session.
router.get(
  '/me',
  requireVerifiedEmail,
  validate(listMyInvitationsSchema),
  invitationCtrl.listMyInvitations,
)
router.post('/accept', validate(acceptInvitationSchema), invitationCtrl.acceptInvitation)
router.post('/decline', validate(declineInvitationSchema), invitationCtrl.declineInvitation)

export default router
