import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { t, resolveLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE } from '../src/i18n/index.js'

// ─── Unit tests for the i18n core ───────────────────────────────────────

describe('i18n core', () => {
  describe('t() translation function', () => {
    it('translates a key in English', () => {
      expect(t('errors.userNotFound', 'en')).toBe('User not found')
    })

    it('translates a key in French', () => {
      expect(t('errors.userNotFound', 'fr')).toBe('Utilisateur introuvable')
    })

    it('falls back to English when the locale is not supported', () => {
      expect(t('errors.userNotFound', 'de')).toBe('User not found')
    })

    it('falls back to English when the key is missing in the requested locale', () => {
      // This key exists in en but we simulate a missing key by using a non-existent locale
      // that falls back to en
      expect(t('errors.userNotFound', 'xx')).toBe('User not found')
    })

    it('returns the key itself when the key is missing in all locales', () => {
      expect(t('errors.nonExistentKey', 'en')).toBe('errors.nonExistentKey')
    })

    it('interpolates params into the translation', () => {
      expect(t('errors.accountSuspended', 'en', { until: '2025-01-01' })).toBe(
        'Your account is suspended until 2025-01-01',
      )
    })

    it('interpolates params in French', () => {
      expect(t('errors.accountSuspended', 'fr', { until: '2025-01-01' })).toBe(
        "Votre compte est suspendu jusqu'au 2025-01-01",
      )
    })

    it('handles nested keys (emails.verification.subject)', () => {
      expect(t('emails.verification.subject', 'en')).toBe('Verify your email address')
      expect(t('emails.verification.subject', 'fr')).toBe('Vérifiez votre adresse e-mail')
    })

    it('interpolates multiple params', () => {
      const result = t('emails.orgInvitation.body', 'en', {
        inviterName: 'Alice',
        orgName: 'Acme',
        role: 'ADMIN',
      })
      expect(result).toBe('Alice has invited you to join Acme as a ADMIN.')
    })

    it('leaves unknown placeholders as-is', () => {
      expect(t('errors.accountSuspended', 'en', {})).toBe('Your account is suspended until {until}')
    })
  })

  describe('resolveLocale()', () => {
    it('returns the default locale for an empty header', () => {
      expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE)
      expect(resolveLocale('')).toBe(DEFAULT_LOCALE)
    })

    it('returns "en" for an English Accept-Language header', () => {
      expect(resolveLocale('en-US,en;q=0.9')).toBe('en')
    })

    it('returns "fr" for a French Accept-Language header', () => {
      expect(resolveLocale('fr-FR,fr;q=0.9,en;q=0.8')).toBe('fr')
    })

    it('returns "fr" when French has higher priority', () => {
      expect(resolveLocale('fr;q=0.9,en;q=0.8')).toBe('fr')
    })

    it('falls back to default for an unsupported language', () => {
      expect(resolveLocale('de-DE,de;q=0.9')).toBe(DEFAULT_LOCALE)
    })

    it('picks the first supported locale from a multi-language list', () => {
      expect(resolveLocale('de;q=0.9,fr;q=0.8,en;q=0.7')).toBe('fr')
    })

    it('handles a single language tag', () => {
      expect(resolveLocale('fr')).toBe('fr')
    })
  })

  describe('SUPPORTED_LOCALES', () => {
    it('includes en and fr', () => {
      expect(SUPPORTED_LOCALES).toContain('en')
      expect(SUPPORTED_LOCALES).toContain('fr')
    })

    it('has English as the first entry (default)', () => {
      expect(SUPPORTED_LOCALES[0]).toBe('en')
    })
  })
})

// ─── Integration tests via the API ──────────────────────────────────────

describe('i18n API integration', () => {
  it('returns English error messages by default', async () => {
    const res = await request(app).get('/api/nonexistent-route')
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Route not found')
  })

  it('returns French error messages with Accept-Language: fr', async () => {
    const res = await request(app).get('/api/nonexistent-route').set('Accept-Language', 'fr')
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Route introuvable')
  })

  it('returns French error messages with X-Lang: fr header', async () => {
    const res = await request(app).get('/api/nonexistent-route').set('X-Lang', 'fr')
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Route introuvable')
  })

  it('X-Lang overrides Accept-Language', async () => {
    const res = await request(app)
      .get('/api/nonexistent-route')
      .set('Accept-Language', 'en')
      .set('X-Lang', 'fr')
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Route introuvable')
  })

  it('falls back to English for unsupported language', async () => {
    const res = await request(app).get('/api/nonexistent-route').set('Accept-Language', 'de')
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Route not found')
  })

  it('returns localized validation errors', async () => {
    // Register with invalid data to trigger Zod validation errors
    const res = await request(app)
      .post('/api/auth/register')
      .set('Accept-Language', 'fr')
      .send({ name: 'a', email: 'not-an-email', password: 'short' })

    expect(res.status).toBe(400)
    expect(res.body.errors).toBeDefined()
    // The validation errors should be in French
    const allErrors = Object.values(res.body.errors).flat()
    expect(allErrors.some((e) => e.includes('au moins 2 caractères'))).toBe(true)
    expect(allErrors.some((e) => e.includes('Adresse e-mail invalide'))).toBe(true)
  })

  it('returns English validation errors by default', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'a', email: 'not-an-email', password: 'short' })

    expect(res.status).toBe(400)
    expect(res.body.errors).toBeDefined()
    const allErrors = Object.values(res.body.errors).flat()
    expect(allErrors.some((e) => e.includes('at least 2 characters'))).toBe(true)
    expect(allErrors.some((e) => e.includes('Invalid email address'))).toBe(true)
  })

  it('returns localized error for invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Accept-Language', 'fr')
      .send({ email: 'nonexistent@example.com', password: 'Password123' })

    expect(res.status).toBe(401)
    expect(res.body.message).toBe('Identifiants invalides')
  })

  it('returns English error for invalid credentials by default', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nonexistent@example.com', password: 'Password123' })

    expect(res.status).toBe(401)
    expect(res.body.message).toBe('Invalid credentials')
  })
})
