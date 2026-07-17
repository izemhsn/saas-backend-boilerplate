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
} from './org.schema.js'
import * as ctrl from './org.controller.js'

const router = Router()

// All org routes require authentication
router.use(authenticate)

// Create + list (no orgId param)
router.post('/', validate(createOrgSchema), ctrl.createOrganization)
router.get('/', ctrl.listOrganizations)

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
router.get('/:orgId/members', validate(orgIdParamSchema), requireTenant, ctrl.listMembers)
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

export default router
