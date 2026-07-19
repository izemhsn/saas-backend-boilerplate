import { Router } from 'express'
import { validate } from '../../middleware/validate.middleware.js'
import { authenticate } from '../../middleware/auth.middleware.js'
import { createApiKeySchema, keyIdParamSchema, listApiKeysSchema } from './apikey.schema.js'
import * as ctrl from './apikey.controller.js'

const router = Router()

router.use(authenticate)

router.post('/', validate(createApiKeySchema), ctrl.createApiKey)
router.get('/', validate(listApiKeysSchema), ctrl.listApiKeys)
router.get('/:keyId', validate(keyIdParamSchema), ctrl.getApiKey)
router.post('/:keyId/revoke', validate(keyIdParamSchema), ctrl.revokeApiKey)
router.delete('/:keyId', validate(keyIdParamSchema), ctrl.deleteApiKey)

export default router
