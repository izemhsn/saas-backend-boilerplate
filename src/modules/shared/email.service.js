import { Resend } from 'resend'
import logger from '../../utils/logger.js'
import { t as translate, DEFAULT_LOCALE } from '../../i18n/index.js'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

const FROM = process.env.FROM_EMAIL ?? 'noreply@example.com'
const APP_URL = process.env.APP_URL ?? 'http://localhost:3000'

// Escape user-derived values before interpolating them into email HTML so a
// crafted name/org name can't inject markup into the message body.
const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

// Build the HTML email body from locale-specific template strings.
// All text is pulled from the i18n locale files so emails are sent in the
// user's preferred language.
const buildEmailHtml = (strings, { url, button }) => `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2>${strings.heading}</h2>
      <p>${strings.greeting},</p>
      <p>${strings.body}</p>
      <a href="${url}"
         style="display: inline-block; background: #4f46e5; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin: 16px 0;">
        ${button}
      </a>
      <p>${strings.copyLink}</p>
      <p><a href="${url}">${url}</a></p>
      <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
        ${strings.footer}
      </p>
    </div>
  `

export const sendVerificationEmail = async ({ to, token, name, locale = DEFAULT_LOCALE }) => {
  const verifyUrl = `${APP_URL}/verify-email?token=${token}`
  const strings = {
    heading: translate('emails.verification.heading', locale),
    greeting: translate('emails.verification.greeting', locale, {
      name: name ? ` ${escapeHtml(name)}` : '',
    }),
    body: translate('emails.verification.body', locale),
    copyLink: translate('emails.verification.copyLink', locale),
    footer: translate('emails.verification.footer', locale),
  }
  const button = translate('emails.verification.button', locale)
  const subject = translate('emails.verification.subject', locale)

  const html = buildEmailHtml(strings, { url: verifyUrl, button })

  if (!resend) {
    logger.warn('[email] RESEND_API_KEY not set — skipping email send (dev mode)')
    return { id: 'dev-mode-skipped' }
  }

  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject,
    html,
  })

  if (error)
    throw new Error(
      translate('errors.failedToSendVerificationEmail', locale, { message: error.message }),
    )
}

export const sendPasswordResetEmail = async ({ to, token, name, locale = DEFAULT_LOCALE }) => {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`
  const strings = {
    heading: translate('emails.passwordReset.heading', locale),
    greeting: translate('emails.passwordReset.greeting', locale, {
      name: name ? ` ${escapeHtml(name)}` : '',
    }),
    body: translate('emails.passwordReset.body', locale),
    copyLink: translate('emails.passwordReset.copyLink', locale),
    footer: translate('emails.passwordReset.footer', locale),
  }
  const button = translate('emails.passwordReset.button', locale)
  const subject = translate('emails.passwordReset.subject', locale)

  const html = buildEmailHtml(strings, { url: resetUrl, button })

  if (!resend) {
    logger.warn('[email] RESEND_API_KEY not set — skipping email send (dev mode)')
    return { id: 'dev-mode-skipped' }
  }

  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject,
    html,
  })

  if (error)
    throw new Error(
      translate('errors.failedToSendPasswordResetEmail', locale, { message: error.message }),
    )
}

export const sendOrgInvitationEmail = async ({
  to,
  orgName,
  inviterName,
  role,
  token,
  locale = DEFAULT_LOCALE,
}) => {
  const inviteUrl = `${APP_URL}/invitations/accept?token=${token}`
  const strings = {
    heading: translate('emails.orgInvitation.heading', locale, { orgName: escapeHtml(orgName) }),
    greeting: '',
    body: translate('emails.orgInvitation.body', locale, {
      inviterName: escapeHtml(inviterName),
      orgName: escapeHtml(orgName),
      role,
    }),
    copyLink: translate('emails.orgInvitation.copyLink', locale),
    footer: translate('emails.orgInvitation.footer', locale),
  }
  const button = translate('emails.orgInvitation.button', locale)
  const subject = translate('emails.orgInvitation.subject', locale, { orgName })

  const html = buildEmailHtml(strings, { url: inviteUrl, button })

  if (!resend) {
    logger.warn('[email] RESEND_API_KEY not set — skipping email send (dev mode)')
    return { id: 'dev-mode-skipped' }
  }

  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject,
    html,
  })

  if (error)
    throw new Error(
      translate('errors.failedToSendOrgInvitationEmail', locale, { message: error.message }),
    )
}
