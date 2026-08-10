import { z } from 'zod'

export const enableTwoFactorSchema = z.object({
  body: z.object({
    code: z.string().min(6, 'validation.verificationCodeRequired').max(6, 'validation.code6Digits'),
  }),
})

export const disableTwoFactorSchema = z.object({
  body: z.object({
    password: z.string().min(1, 'validation.passwordRequired'),
  }),
})

export const verifyTwoFactorSchema = z.object({
  body: z.object({
    challengeToken: z.string().min(1, 'validation.challengeTokenRequired'),
    code: z.string().min(1, 'validation.verificationCodeRequired'),
  }),
})
