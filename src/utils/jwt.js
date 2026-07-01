import jwt from 'jsonwebtoken'

export const signToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  })

export const signRefreshToken = (payload) =>
  jwt.sign(payload, process.env.JWT_REFRESH_SECRET ?? process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  })

export const verifyToken = (token) => jwt.verify(token, process.env.JWT_SECRET)

export const verifyRefreshToken = (token) => jwt.verify(token, process.env.JWT_REFRESH_SECRET ?? process.env.JWT_SECRET)