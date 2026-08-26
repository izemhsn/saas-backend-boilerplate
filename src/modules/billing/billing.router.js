import { Router } from 'express'
import { validate } from '../../middleware/validate.middleware.js'
import { authenticate } from '../../middleware/auth.middleware.js'
import { requireTenant, requireOrgRole } from '../../middleware/tenant.middleware.js'
import { checkoutSchema, portalSchema, listPlansSchema } from './billing.schema.js'
import * as ctrl from './billing.controller.js'

const router = Router()

// Public — list available plans
router.get('/plans', validate(listPlansSchema), ctrl.listPlans)

// Webhook — mounted separately in app.js with express.raw()

// Protected — require authentication
router.get('/subscription', authenticate, ctrl.getSubscription)
router.post('/checkout', authenticate, validate(checkoutSchema), ctrl.createCheckout)
router.post('/portal', authenticate, validate(portalSchema), ctrl.createPortal)
router.post('/cancel', authenticate, ctrl.cancelSubscription)

export default router

// ─────────────────────────────────────────────────────────────────────────
// Org-scoped billing (M12), mounted separately at
// /api/organizations/:orgId/billing. The checkout/portal/cancel schemas are
// reused as-is — the request body shape doesn't change, only what the
// subscription attaches to. Any member can read the org's subscription;
// only OWNER/ADMIN can start a checkout, open the billing portal, or cancel —
// these move real money and should not be a MEMBER action.
// ─────────────────────────────────────────────────────────────────────────
export const orgRouter = Router({ mergeParams: true })

orgRouter.use(authenticate, requireTenant)

orgRouter.get('/subscription', ctrl.getOrgSubscription)
orgRouter.post(
  '/checkout',
  requireOrgRole('OWNER', 'ADMIN'),
  validate(checkoutSchema),
  ctrl.createOrgCheckout,
)
orgRouter.post(
  '/portal',
  requireOrgRole('OWNER', 'ADMIN'),
  validate(portalSchema),
  ctrl.createOrgPortal,
)
orgRouter.post('/cancel', requireOrgRole('OWNER', 'ADMIN'), ctrl.cancelOrgSubscription)
