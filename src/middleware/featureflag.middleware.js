import { evaluateFlag } from '../modules/featureflag/featureflag.service.js'

// Gates a route behind a feature flag. Must run after `authenticate`.
// For org-scoped flags, also run after `requireTenant`.
// Usage: router.get('/beta', authenticate, requireFeatureFlag('beta_feature'), ctrl.beta)
export const requireFeatureFlag = (key) => async (req, res, next) => {
  try {
    const orgId = req.tenant?.id ?? null
    let planName = null

    if (req.subscription?.plan?.name) {
      planName = req.subscription.plan.name
    }

    const result = await evaluateFlag(key, orgId, planName)

    if (!result.enabled) {
      return res.status(403).json({
        success: false,
        message: req.t('errors.featureNotEnabled', { key }),
      })
    }

    req.featureFlag = result
    next()
  } catch (err) {
    next(err)
  }
}
