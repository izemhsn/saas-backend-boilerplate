import { describe, it, expect } from 'vitest'
import { sanitizeString, sanitizeValue } from '../src/middleware/sanitize.middleware.js'

describe('sanitizeString', () => {
  it('strips HTML tags', () => {
    expect(sanitizeString('<script>alert("xss")</script>')).toBe('alert("xss")')
    expect(sanitizeString('<img src=x>')).toBe('')
    expect(sanitizeString('<div>content</div>')).toBe('content')
  })

  it('strips javascript: URIs', () => {
    expect(sanitizeString('javascript:alert(1)')).toBe('alert(1)')
    expect(sanitizeString('JAVASCRIPT:alert(1)')).toBe('alert(1)')
  })

  it('strips on* event handlers', () => {
    expect(sanitizeString('<img onerror=alert(1) src=x>')).toBe('')
    expect(sanitizeString('text onload=evil()')).toBe('text')
  })

  it('preserves safe strings', () => {
    expect(sanitizeString('Hello World')).toBe('Hello World')
    expect(sanitizeString('user@example.com')).toBe('user@example.com')
    expect(sanitizeString('Tom & Jerry')).toBe('Tom & Jerry')
  })

  it('preserves ampersands and special chars outside HTML', () => {
    expect(sanitizeString('a < b && c > d')).toBe('a < b && c > d')
    expect(sanitizeString('price < 100')).toBe('price < 100')
  })

  it('returns non-strings unchanged', () => {
    expect(sanitizeString(42)).toBe(42)
    expect(sanitizeString(null)).toBeNull()
    expect(sanitizeString(undefined)).toBeUndefined()
  })
})

describe('sanitizeValue — prototype pollution', () => {
  it('strips __proto__ key', () => {
    const input = JSON.parse('{"name":"test","__proto__":{"polluted":true}}')
    const result = sanitizeValue(input)
    expect(Object.keys(result)).not.toContain('__proto__')
    expect(result.name).toBe('test')
    expect(Object.prototype.polluted).toBeUndefined()
  })

  it('strips constructor key', () => {
    const input = JSON.parse('{"name":"test","constructor":{"prototype":{"polluted":true}}}')
    const result = sanitizeValue(input)
    expect(Object.keys(result)).not.toContain('constructor')
    expect(result.name).toBe('test')
  })

  it('strips prototype key', () => {
    const input = { name: 'test', prototype: { polluted: true } }
    const result = sanitizeValue(input)
    expect(result.prototype).toBeUndefined()
    expect(result.name).toBe('test')
  })
})

describe('sanitizeValue — operator injection', () => {
  it('strips $-prefixed keys', () => {
    const input = { $gt: '', $or: [], $where: 'this.password', name: 'test' }
    const result = sanitizeValue(input)
    expect(result.$gt).toBeUndefined()
    expect(result.$or).toBeUndefined()
    expect(result.$where).toBeUndefined()
    expect(result.name).toBe('test')
  })

  it('strips $-prefixed keys in nested objects', () => {
    const input = { filter: { $contains: 'evil', name: 'test' } }
    const result = sanitizeValue(input)
    expect(result.filter.$contains).toBeUndefined()
    expect(result.filter.name).toBe('test')
  })
})

describe('sanitizeValue — XSS in nested structures', () => {
  it('sanitizes strings in nested objects', () => {
    const input = { user: { name: '<script>alert(1)</script>', email: 'a@b.com' } }
    const result = sanitizeValue(input)
    expect(result.user.name).toBe('alert(1)')
    expect(result.user.email).toBe('a@b.com')
  })

  it('sanitizes strings in arrays', () => {
    const input = { tags: ['<b>safe</b>', 'normal', '<script>xss</script>'] }
    const result = sanitizeValue(input)
    expect(result.tags).toEqual(['safe', 'normal', 'xss'])
  })

  it('handles null and undefined values', () => {
    const input = { a: null, b: undefined, c: 'text' }
    const result = sanitizeValue(input)
    expect(result.a).toBeNull()
    expect(result.b).toBeUndefined()
    expect(result.c).toBe('text')
  })

  it('handles numbers and booleans', () => {
    const input = { a: 42, b: true, c: false }
    const result = sanitizeValue(input)
    expect(result.a).toBe(42)
    expect(result.b).toBe(true)
    expect(result.c).toBe(false)
  })

  it('prevents excessive recursion with depth limit', () => {
    let nested = { value: 'deep' }
    for (let i = 0; i < 15; i++) {
      nested = { child: nested }
    }
    const result = sanitizeValue(nested)
    expect(result).toBeDefined()
  })
})

describe('sanitizeValue — combined attacks', () => {
  it('handles prototype pollution + XSS + operator injection together', () => {
    const input = JSON.parse('{"__proto__":{"admin":true},"$where":"this.password","name":"<script>document.cookie</script>","bio":"javascript:steal()","profile":{"onload":"evil()","real":"data"}}')
    const result = sanitizeValue(input)
    expect(Object.keys(result)).not.toContain('__proto__')
    expect(result.$where).toBeUndefined()
    expect(result.name).toBe('document.cookie')
    expect(result.bio).toBe('steal()')
    expect(result.profile.real).toBe('data')
  })
})
