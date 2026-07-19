import { Router } from 'express'
import { validate } from '../../middleware/validate.middleware.js'
import { authenticate } from '../../middleware/auth.middleware.js'
import { listSessionsSchema, sessionIdParamSchema } from './session.schema.js'
import * as ctrl from './session.controller.js'

const router = Router()

router.use(authenticate)

router.get('/', validate(listSessionsSchema), ctrl.listSessions)
router.post('/:sessionId/revoke', validate(sessionIdParamSchema), ctrl.revokeSession)
router.post('/revoke-all', ctrl.revokeAllSessions)

export default router
