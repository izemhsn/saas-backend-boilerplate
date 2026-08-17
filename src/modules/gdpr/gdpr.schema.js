import { z } from 'zod'

export const deleteAccountSchema = z.object({
  body: z.object({
    password: z.string().min(1, 'validation.passwordRequiredDelete'),
  }),
})

// Password is optional at the schema level because OAuth-only accounts have
// none — the service enforces it for accounts that do have a password.
export const exportDataSchema = z.object({
  body: z
    .object({
      password: z.string().min(1).optional(),
    })
    .default({}),
})
