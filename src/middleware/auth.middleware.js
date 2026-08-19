import { verifyToken } from '../utils/jwt.js'
import { prisma } from '../config/db.js'

export const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization

  // Expect: "Authorization: Bearer <token>"
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: req.t('errors.noTokenProvided'),
    })
  }

  // Only JWT verification failures map to 401 — a DB outage below must surface
  // as a 500 through the error handler, not masquerade as an invalid token.
  let decoded
  try {
    const token = authHeader.split(' ')[1]
    decoded = verifyToken(token) // { id, email, role, tokenVersion }
  } catch {
    return res.status(401).json({
      success: false,
      message: req.t('errors.invalidOrExpiredToken'),
    })
  }

  try {
    // Verify the user still exists and the token version matches
    const user = await prisma.user.findFirst({
      where: { id: decoded.id, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        tokenVersion: true,
        banned: true,
        suspendedUntil: true,
      },
    })

    if (!user) {
      return res.status(401).json({ success: false, message: req.t('errors.userNoLongerExists') })
    }

    if (decoded.tokenVersion !== user.tokenVersion) {
      return res.status(401).json({ success: false, message: req.t('errors.tokenInvalidated') })
    }

    if (user.banned) {
      return res.status(403).json({ success: false, message: req.t('errors.accountBanned') })
    }

    if (user.suspendedUntil && user.suspendedUntil > new Date()) {
      return res.status(403).json({
        success: false,
        message: req.t('errors.accountSuspended', { until: user.suspendedUntil.toISOString() }),
      })
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    }
    next()
  } catch (err) {
    next(err)
  }
}

// Usage: router.get('/admin', authenticate, authorize('ADMIN'), ctrl.adminOnly)
export const authorize =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: req.t('errors.noTokenProvided') })
    }
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ success: false, message: req.t('errors.insufficientPermissions') })
    }
    next()
  }

// Gate business routes behind a verified email. Must run after authenticate.
// Usage: router.get('/projects', authenticate, requireVerifiedEmail, ctrl.list)
export const requireVerifiedEmail = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: req.t('errors.noTokenProvided') })
  }
  try {
    const user = await prisma.user.findFirst({
      where: { id: req.user.id, deletedAt: null },
      select: { emailVerified: true },
    })
    if (!user || !user?.emailVerified) {
      return res.status(403).json({ success: false, message: req.t('errors.emailNotVerified') })
    }
    next()
  } catch (err) {
    next(err)
  }
}
