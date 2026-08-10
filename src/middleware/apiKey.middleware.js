import { verifyApiKey } from '../modules/apikey/apikey.service.js'

// Authenticates requests using an API key passed in the `X-API-Key` header.
// On success, attaches { id, email, role } to req.user and { id, scopes } to req.apiKey.
// Usage: router.get('/projects', authenticateApiKey, ctrl.list)
export const authenticateApiKey = async (req, res, next) => {
  const rawKey = req.headers['x-api-key']

  if (!rawKey) {
    return res.status(401).json({ success: false, message: req.t('errors.noApiKeyProvided') })
  }

  try {
    const result = await verifyApiKey(rawKey)

    if (!result) {
      return res
        .status(401)
        .json({ success: false, message: req.t('errors.invalidOrExpiredApiKey') })
    }

    req.user = {
      id: result.user.id,
      email: result.user.email,
      role: result.user.role,
    }
    req.apiKey = {
      id: result.id,
      scopes: result.scopes,
    }
    next()
  } catch (err) {
    next(err)
  }
}

// Checks that the authenticated API key has the required scope.
// Must run after `authenticateApiKey`.
// Usage: router.post('/export', authenticateApiKey, requireScope('exports:write'), ctrl.export)
export const requireScope =
  (...scopes) =>
  (req, res, next) => {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: req.t('errors.noApiKeyContext') })
    }

    const hasScope = scopes.some((scope) => req.apiKey.scopes.includes(scope))

    if (!hasScope) {
      return res.status(403).json({
        success: false,
        message: req.t('errors.requiredScope', { scopes: scopes.join(' or ') }),
      })
    }

    next()
  }
