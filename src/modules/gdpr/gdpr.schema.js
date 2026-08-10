import { z } from 'zod'

export const deleteAccountSchema = z.object({
  body: z.object({
    password: z.string().min(1, 'validation.passwordRequiredDelete'),
  }),
})
