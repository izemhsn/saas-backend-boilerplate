import { Router } from 'express'
import { validate } from '../../middleware/validate.middleware.js'
import { authenticate, authorize } from '../../middleware/auth.middleware.js'
import {
  createFlagSchema,
  updateFlagSchema,
  flagIdParamSchema,
  listFlagsSchema,
  setOverrideSchema,
  overrideParamSchema,
  evaluateFlagSchema,
} from './featureflag.schema.js'
import * as ctrl from './featureflag.controller.js'

const router = Router()

// All routes require authentication
router.use(authenticate)

// Evaluate — any authenticated user
router.get('/evaluate', validate(evaluateFlagSchema), ctrl.evaluateFlag)

// Admin CRUD — requires ADMIN role
router.post('/', authorize('ADMIN'), validate(createFlagSchema), ctrl.createFlag)
router.get('/', authorize('ADMIN'), validate(listFlagsSchema), ctrl.listFlags)
router.get('/:flagId', authorize('ADMIN'), validate(flagIdParamSchema), ctrl.getFlag)
router.patch('/:flagId', authorize('ADMIN'), validate(updateFlagSchema), ctrl.updateFlag)
router.delete('/:flagId', authorize('ADMIN'), validate(flagIdParamSchema), ctrl.deleteFlag)

// Overrides — admin only
router.post(
  '/:flagId/overrides/:orgId',
  authorize('ADMIN'),
  validate(setOverrideSchema),
  ctrl.setOverride,
)
router.delete(
  '/:flagId/overrides/:orgId',
  authorize('ADMIN'),
  validate(overrideParamSchema),
  ctrl.removeOverride,
)

export default router
