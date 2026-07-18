import { describe, it, expect } from 'vitest'
import { paginationParams, paginationMeta, parseSort, buildSearch } from '../src/utils/query.js'

describe('paginationParams', () => {
  it('computes skip and take from page and limit', () => {
    expect(paginationParams(1, 20)).toEqual({ skip: 0, take: 20 })
    expect(paginationParams(3, 10)).toEqual({ skip: 20, take: 10 })
    expect(paginationParams(5, 25)).toEqual({ skip: 100, take: 25 })
  })
})

describe('paginationMeta', () => {
  it('returns full metadata for a multi-page result', () => {
    const meta = paginationMeta(2, 10, 25)
    expect(meta).toEqual({
      page: 2,
      limit: 10,
      total: 25,
      totalPages: 3,
      hasNext: true,
      hasPrev: true,
    })
  })

  it('returns hasNext=false on last page', () => {
    const meta = paginationMeta(3, 10, 25)
    expect(meta.hasNext).toBe(false)
    expect(meta.hasPrev).toBe(true)
  })

  it('returns hasPrev=false on first page', () => {
    const meta = paginationMeta(1, 10, 25)
    expect(meta.hasPrev).toBe(false)
    expect(meta.hasNext).toBe(true)
  })

  it('handles zero results', () => {
    const meta = paginationMeta(1, 20, 0)
    expect(meta.totalPages).toBe(0)
    expect(meta.hasNext).toBe(false)
    expect(meta.hasPrev).toBe(false)
  })

  it('handles exact page boundary', () => {
    const meta = paginationMeta(2, 10, 20)
    expect(meta.totalPages).toBe(2)
    expect(meta.hasNext).toBe(false)
  })
})

describe('parseSort', () => {
  it('returns orderBy object for valid field', () => {
    expect(parseSort('email', 'asc', ['createdAt', 'email', 'name'])).toEqual({ email: 'asc' })
    expect(parseSort('createdAt', 'desc', ['createdAt', 'email', 'name'])).toEqual({
      createdAt: 'desc',
    })
  })

  it('falls back to first allowed field for invalid sort', () => {
    expect(parseSort('password', 'asc', ['createdAt', 'email', 'name'])).toEqual({
      createdAt: 'asc',
    })
  })

  it('falls back to first allowed field for undefined sort', () => {
    expect(parseSort(undefined, 'desc', ['createdAt', 'email', 'name'])).toEqual({
      createdAt: 'desc',
    })
  })
})

describe('buildSearch', () => {
  it('returns undefined when no search term', () => {
    expect(buildSearch(undefined, ['email', 'name'])).toBeUndefined()
    expect(buildSearch('', ['email', 'name'])).toBeUndefined()
  })

  it('returns OR clause with insensitive contains for each field', () => {
    const result = buildSearch('john', ['email', 'name'])
    expect(result).toEqual([
      { email: { contains: 'john', mode: 'insensitive' } },
      { name: { contains: 'john', mode: 'insensitive' } },
    ])
  })

  it('handles single field', () => {
    const result = buildSearch('acme', ['slug'])
    expect(result).toEqual([{ slug: { contains: 'acme', mode: 'insensitive' } }])
  })

  it('handles nested relation paths', () => {
    const result = buildSearch('acme', ['organization.name', 'organization.slug'])
    expect(result).toEqual([
      { organization: { name: { contains: 'acme', mode: 'insensitive' } } },
      { organization: { slug: { contains: 'acme', mode: 'insensitive' } } },
    ])
  })
})
