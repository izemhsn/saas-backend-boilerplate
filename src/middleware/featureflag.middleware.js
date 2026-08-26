import { evaluateFlag } from '../modules/featureflag/featureflag.service.js'

// Gates a route behind a feature flag. Must run after `authenticate`.
// For org-scoped flags, also run after `requireTenant`.
// Usage: router.get('/beta', authenticate, requireFeatureFlag('beta_feature'), ctrl.beta)
export const requireFeatureFlag = (key) => async (req, res, next) => {
  try {
    const orgId = req.tenant?.id ?? null
    // Matched against PLAN-flag `value.plans` by the plan's immutable `code`,
    // not its display `name` — same reasoning as requirePlan (audit M11).
    let planCode = null

    if (req.subscription?.plan?.code) {
      planCode = req.subscription.plan.code
    }

    const result = await evaluateFlag(key, orgId, planCode)

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
