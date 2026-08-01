import { z } from 'zod'

export const enableTwoFactorSchema = z.object({
  body: z.object({
    code: z.string().min(6, 'Verification code is required').max(6, 'Code must be 6 digits'),
  }),
})

export const disableTwoFactorSchema = z.object({
  body: z.object({
    password: z.string().min(1, 'Password is required'),
  }),
})

export const verifyTwoFactorSchema = z.object({
  body: z.object({
    challengeToken: z.string().min(1, 'Challenge token is required'),
    code: z.string().min(1, 'Verification code is required'),
  }),
})
