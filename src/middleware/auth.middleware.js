import { verifyToken } from '../utils/jwt.js'

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