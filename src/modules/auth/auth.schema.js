import { z } from 'zod'

export const registerSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'validation.nameMinLength'),
    email: z.string().email('validation.invalidEmail'),
    password: z
      .string()
      .min(8, 'validation.passwordMinLength')
      .regex(/[A-Z]/, 'validation.passwordUppercase')
      .regex(/[0-9]/, 'validation.passwordNumber'),
  }),
})

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('validation.invalidEmail'),
    password: z.string().min(1, 'validation.passwordRequired'),
  }),
})

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'validation.refreshTokenRequired'),
  }),
})

export const verifyEmailSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'validation.verificationTokenRequired'),
  }),
})

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'validation.currentPasswordRequired'),
    newPassword: z
      .string()
      .min(8, 'validation.passwordMinLength')
      .regex(/[A-Z]/, 'validation.passwordUppercase')
      .regex(/[0-9]/, 'validation.passwordNumber'),
  }),
})

export const changeEmailSchema = z.object({
  body: z.object({
    newEmail: z.string().email('validation.invalidEmail'),
    password: z.string().min(1, 'validation.passwordRequiredConfirm'),
  }),
})

export const resendVerificationSchema = z.object({
  body: z.object({
    email: z.string().email('validation.invalidEmail'),
  }),
})

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email('validation.invalidEmail'),
  }),
})

export const logoutSchema = z.object({
  body: z
    .object({
      refreshToken: z.string().min(1).optional(),
    })
    .default({}),
})

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'validation.resetTokenRequired'),
    newPassword: z
      .string()
      .min(8, 'validation.passwordMinLength')
      .regex(/[A-Z]/, 'validation.passwordUppercase')
      .regex(/[0-9]/, 'validation.passwordNumber'),
  }),
})

export const googleLoginSchema = z.object({
  body: z.object({
    code: z.string().min(1, 'validation.authorizationCodeRequired'),
  }),
})
