import { verifyToken } from '../utils/jwt.js'
import { prisma } from '../config/db.js'

export const authenticate = (req, res, next) => {
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
    req.user = verifyToken(token) // adds { id, email, role } to request
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
