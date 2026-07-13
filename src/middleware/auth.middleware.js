import { verifyToken } from '../utils/jwt.js'
import { prisma } from '../config/db.js'

export const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization

  // Expect: "Authorization: Bearer <token>"
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'No token provided',
    })
  }

  try {
    const token = authHeader.split(' ')[1]
    const decoded = verifyToken(token) // { id, email, role, tokenVersion }

    // Verify the user still exists and the token version matches
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, role: true, tokenVersion: true },
    })

    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists' })
    }

    if (decoded.tokenVersion !== user.tokenVersion) {
      return res.status(401).json({ success: false, message: 'Token has been invalidated' })
    }

    req.user = { id: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion }
    next()
  } catch {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    })
  }
}

// Usage: router.get('/admin', authenticate, authorize('ADMIN'), ctrl.adminOnly)
export const authorize =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'No token provided' })
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' })
    }
    next()
  }

// Gate business routes behind a verified email. Must run after authenticate.
// Usage: router.get('/projects', authenticate, requireVerifiedEmail, ctrl.list)
export const requireVerifiedEmail = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'No token provided' })
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { emailVerified: true },
    })
    if (!user?.emailVerified) {
      return res.status(403).json({ success: false, message: 'Email not verified' })
    }
    next()
  } catch (err) {
    next(err)
  }
}
