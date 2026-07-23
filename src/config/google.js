import { OAuth2Client } from 'google-auth-library'

export const isGoogleConfigured = () =>
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET

export const getGoogleClient = () => {
  if (!isGoogleConfigured()) return null
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ?? 'postmessage',
  )
}

export const getGoogleAuthUrl = (state) => {
  const client = getGoogleClient()
  if (!client) return null

  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    prompt: 'consent',
    ...(state && { state }),
  })
}
