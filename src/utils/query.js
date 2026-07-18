export const paginationParams = (page, limit) => ({
  skip: (page - 1) * limit,
  take: limit,
})

export const paginationMeta = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
  hasNext: page * limit < total,
  hasPrev: page > 1,
})

export const parseSort = (sort, order, allowedFields) => {
  const field = allowedFields.includes(sort) ? sort : allowedFields[0]
  return { [field]: order }
}

const setNestedValue = (path, value) => {
  const parts = path.split('.')
  if (parts.length === 1) return { [parts[0]]: value }
  const [head, ...rest] = parts
  return { [head]: setNestedValue(rest.join('.'), value) }
}

export const buildSearch = (search, fields) => {
  if (!search) return undefined
  return fields.map((field) =>
    setNestedValue(field, { contains: search, mode: 'insensitive' }),
  )
}
