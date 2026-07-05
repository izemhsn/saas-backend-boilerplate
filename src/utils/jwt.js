import jwt from 'jsonwebtoken'
import { randomUUID } from 'crypto'

export const signToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    algorithm: 'HS256',
  })

// jwtid guarantees a unique token even when minted for the same user within the same second (e.g. refresh-token rotation)
export const signRefreshToken = (payload) =>
  jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    jwtid: randomUUID(),
    algorithm: 'HS256',
  })

export const verifyToken = (token) => jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] })

export const verifyRefreshToken = (token) => jwt.verify(token, process.env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] })