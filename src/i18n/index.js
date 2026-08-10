import en from './locales/en.json' with { type: 'json' }
import fr from './locales/fr.json' with { type: 'json' }

// ─── Supported locales ───────────────────────────────────────────────────
// The first entry is the default/fallback locale. To add a new language,
// create a JSON file in locales/ and add it here.
export const SUPPORTED_LOCALES = ['en', 'fr']
export const DEFAULT_LOCALE = 'en'

const locales = { en, fr }

// ─── Nested key lookup ───────────────────────────────────────────────────
// Resolves dot-notation keys like "errors.userNotFound" against a locale
// object. Returns undefined if any segment is missing.
const getPath = (obj, key) =>
  key.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), obj)

// ─── Interpolation ───────────────────────────────────────────────────────
// Replaces {paramName} placeholders in the translation string with values
// from the params object. Unknown placeholders are left as-is.
const interpolate = (str, params = {}) =>
  typeof str === 'string'
    ? str.replace(/\{(\w+)\}/g, (_, name) =>
        params[name] != null ? String(params[name]) : `{${name}}`,
      )
    : str

// ─── Translate ───────────────────────────────────────────────────────────
// Looks up a key in the requested locale, falling back to the default
// locale, then to the key itself (so missing translations are visible but
// never crash). Params are interpolated into the result.
export const t = (key, locale = DEFAULT_LOCALE, params = {}) => {
  const lang = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE
  const value = getPath(locales[lang], key) ?? getPath(locales[DEFAULT_LOCALE], key) ?? key
  return interpolate(value, params)
}

// ─── Locale resolution ───────────────────────────────────────────────────
// Parses the Accept-Language header and returns the best supported locale.
// Examples:
//   "fr-FR,fr;q=0.9,en;q=0.8" → "fr"
//   "en-US"                   → "en"
//   "de"                      → "en" (fallback — German not supported)
//   "fr"                      → "fr"
export const resolveLocale = (acceptLanguage) => {
  if (!acceptLanguage) return DEFAULT_LOCALE

  // Parse "fr-FR;q=0.9, en;q=0.8" → [{ lang: 'fr', q: 0.9 }, { lang: 'en', q: 0.8 }]
  const parsed = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const qParam = params.find((p) => p.trim().startsWith('q='))
      const q = qParam ? parseFloat(qParam.trim().slice(2)) : 1
      const lang = tag.trim().split('-')[0].toLowerCase()
      return { lang, q }
    })
    .filter((entry) => entry.lang)
    .sort((a, b) => b.q - a.q)

  // Return the first supported locale, or the default
  for (const { lang } of parsed) {
    if (SUPPORTED_LOCALES.includes(lang)) return lang
  }
  return DEFAULT_LOCALE
}
