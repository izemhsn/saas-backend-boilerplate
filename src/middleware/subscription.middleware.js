import { prisma } from '../config/db.js'

// Gates routes behind an active (or trialing) subscription.
// Must run after `authenticate`.
// Usage: router.get('/projects', authenticate, requireSubscription, ctrl.list)
export const requireSubscription = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No token provided' })
  }

  try {
    const subscription = await prisma.subscription.findFirst({
      where: {
        userId: req.user.id,
        status: { in: ['ACTIVE', 'TRIALING'] },
      },
      select: {
        id: true,
        status: true,
        plan: { select: { id: true, name: true, features: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!subscription) {
      return res.status(402).json({
        success: false,
        message: 'Active subscription required',
      })
    }

    req.subscription = subscription
    next()
  } catch (err) {
    next(err)
  }
}

// Gates routes behind a specific plan (or set of plans) by plan name.
// Must run after `requireSubscription`.
// Usage: router.post('/export', authenticate, requireSubscription, requirePlan('Pro'), ctrl.export)
export const requirePlan =
  (...planNames) =>
  (req, res, next) => {
    if (!req.subscription) {
      return res.status(402).json({ success: false, message: 'Active subscription required' })
    }

    if (!planNames.includes(req.subscription.plan.name)) {
      return res.status(403).json({
        success: false,
        message: `This feature requires one of: ${planNames.join(', ')}`,
      })
    }

    next()
  }
