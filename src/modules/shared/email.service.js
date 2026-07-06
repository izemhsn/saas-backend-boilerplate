import { Resend } from 'resend'

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

const FROM = process.env.FROM_EMAIL ?? 'noreply@example.com'
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000'

export const sendVerificationEmail = async ({ to, token, name }) => {
  const verifyUrl = `${APP_URL}/verify-email?token=${token}`

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2>Verify your email address</h2>
      <p>Hi${name ? ` ${name}` : ''},</p>
      <p>Please confirm your email address by clicking the button below:</p>
      <a href="${verifyUrl}"
         style="display: inline-block; background: #4f46e5; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin: 16px 0;">
        Verify Email
      </a>
      <p>Or copy this link into your browser:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
        This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
      </p>
    </div>
  `

  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — skipping email send (dev mode)')
    return { id: 'dev-mode-skipped' }
  }

  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: 'Verify your email address',
    html,
  })

  if (error) throw new Error(`Failed to send verification email: ${error.message}`)
}

export const sendPasswordResetEmail = async ({ to, token, name }) => {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2>Reset your password</h2>
      <p>Hi${name ? ` ${name}` : ''},</p>
      <p>We received a request to reset your password. Click the button below to choose a new one:</p>
      <a href="${resetUrl}"
         style="display: inline-block; background: #4f46e5; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin: 16px 0;">
        Reset Password
      </a>
      <p>Or copy this link into your browser:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
        This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
      </p>
    </div>
  `

  if (!resend) {
    console.warn('[email] RESEND_API_KEY not set — skipping email send (dev mode)')
    return { id: 'dev-mode-skipped' }
  }

  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: 'Reset your password',
    html,
  })

  if (error) throw new Error(`Failed to send password reset email: ${error.message}`)
}
