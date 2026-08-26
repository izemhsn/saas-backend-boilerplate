import { prisma } from '../config/db.js'

const subscriptionGateSelect = {
  id: true,
  status: true,
  plan: { select: { id: true, name: true, code: true, features: true } },
}

// Gates routes behind an active (or trialing) subscription tied to the
// authenticated user. Must run after `authenticate`.
// Usage: router.get('/projects', authenticate, requireSubscription, ctrl.list)
export const requireSubscription = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: req.t('errors.noTokenProvided') })
  }

  try {
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId: req.user.id,
        status: { in: ['ACTIVE', 'TRIALING'] },
      },
      select: subscriptionGateSelect,
      orderBy: { createdAt: 'desc' },
    })

    if (!subscription) {
      return res.status(402).json({
        success: false,
        message: req.t('errors.activeSubscriptionRequired'),
      })
    }

    req.subscription = subscription
    next()
  } catch (err) {
    next(err)
  }
}

// Org-scoped counterpart of `requireSubscription` (M12) — gates routes behind
// an active (or trialing) subscription owned by the *organization*, not the
// caller personally. Must run after `requireTenant`, since it reads
// `req.tenant.id` rather than `req.user.id`. Populates the same `req.subscription`
// shape, so `requirePlan` below works unmodified for either gate.
// Usage: router.get('/projects/analytics', authenticate, requireTenant, requireOrgSubscription, ctrl.analytics)
export const requireOrgSubscription = async (req, res, next) => {
  if (!req.tenant) {
    return res.status(400).json({ success: false, message: req.t('errors.noTenantContext') })
  }

  try {
    const subscription = await prisma.subscription.findFirst({
      where: {
        organizationId: req.tenant.id,
        status: { in: ['ACTIVE', 'TRIALING'] },
      },
      select: subscriptionGateSelect,
      orderBy: { createdAt: 'desc' },
    })

    if (!subscription) {
      return res.status(402).json({
        success: false,
        message: req.t('errors.activeSubscriptionRequired'),
      })
    }

    req.subscription = subscription
    next()
  } catch (err) {
    next(err)
  }
}

// Gates routes behind a specific plan (or set of plans), matched by the
// plan's immutable `code` — never its display `name`, which adopters will
// rename (audit M11: gating on `name` let a rename silently revoke or grant
// paid access). Works after either `requireSubscription` or
// `requireOrgSubscription`, since both populate `req.subscription` identically.
// Usage: router.post('/export', authenticate, requireSubscription, requirePlan('pro'), ctrl.export)
export const requirePlan =
  (...planCodes) =>
  (req, res, next) => {
    if (!req.subscription) {
      return res
        .status(402)
        .json({ success: false, message: req.t('errors.activeSubscriptionRequired') })
    }

    if (!planCodes.includes(req.subscription.plan.code)) {
      return res.status(403).json({
        success: false,
        message: req.t('errors.planRequired', { planNames: planCodes.join(', ') }),
      })
    }

    next()
  }
