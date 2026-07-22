import { Router } from 'express'
import { validate } from '../../middleware/validate.middleware.js'
import { authenticate } from '../../middleware/auth.middleware.js'
import { requireTenant, requireOrgRole } from '../../middleware/tenant.middleware.js'
import {
  createOrgSchema,
  updateOrgSchema,
  orgIdParamSchema,
  updateMemberSchema,
  removeMemberSchema,
  listOrgsSchema,
  listMembersSchema,
} from './org.schema.js'
import {
  createInvitationSchema,
  listInvitationsSchema,
  cancelInvitationSchema,
} from './invitation.schema.js'
import * as ctrl from './org.controller.js'
import * as invitationCtrl from './invitation.controller.js'

const router = Router()

// All org routes require authentication
router.use(authenticate)

// Create + list (no orgId param)
router.post('/', validate(createOrgSchema), ctrl.createOrganization)
router.get('/', validate(listOrgsSchema), ctrl.listOrganizations)

// Single-org operations — requireTenant resolves membership
router.get('/:orgId', validate(orgIdParamSchema), requireTenant, ctrl.getOrganization)
router.patch(
  '/:orgId',
  validate(updateOrgSchema),
  requireTenant,
  requireOrgRole('OWNER', 'ADMIN'),
  ctrl.updateOrganization,
)
router.delete(
  '/:orgId',
  validate(orgIdParamSchema),
  requireTenant,
  requireOrgRole('OWNER'),
  ctrl.deleteOrganization,
)

// Members
router.get('/:orgId/members', validate(listMembersSchema), requireTenant, ctrl.listMembers)
router.patch(
  '/:orgId/members/:userId',
  validate(updateMemberSchema),
  requireTenant,
  requireOrgRole('OWNER', 'ADMIN'),
  ctrl.updateMemberRole,
)
router.delete(
  '/:orgId/members/:userId',
  validate(removeMemberSchema),
  requireTenant,
  requireOrgRole('OWNER', 'ADMIN'),
  ctrl.removeMember,
)

// Invitations — org-scoped (require OWNER or ADMIN)
router.post(
  '/:orgId/invitations',
  validate(createInvitationSchema),
  requireTenant,
  requireOrgRole('OWNER', 'ADMIN'),
  invitationCtrl.createInvitation,
)
router.get(
  '/:orgId/invitations',
  validate(listInvitationsSchema),
  requireTenant,
  requireOrgRole('OWNER', 'ADMIN'),
  invitationCtrl.listInvitations,
)
router.delete(
  '/:orgId/invitations/:invitationId',
  validate(cancelInvitationSchema),
  requireTenant,
  requireOrgRole('OWNER', 'ADMIN'),
  invitationCtrl.cancelInvitation,
)

export default router
