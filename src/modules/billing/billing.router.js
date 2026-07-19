import { Router } from 'express'
import { validate } from '../../middleware/validate.middleware.js'
import { authenticate } from '../../middleware/auth.middleware.js'
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
