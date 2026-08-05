// Builds a complete OpenAPI 3.0.3 document from the route registry.
//
// For each operation the builder:
//   - rewrites Express-style `:param` path segments into OpenAPI `{param}` form
//   - derives path & query parameters from the request Zod schema
//   - derives a JSON requestBody from the request Zod schema (when present)
//   - wraps response `data` schemas in the standard `{ success, data }` envelope
//   - attaches the appropriate security requirement
import { zodToOpenApi } from './openapi.converter.js'
import { operations } from './docs.routes.js'

// Map registry security shorthand → OpenAPI security requirement object.
const SECURITY_REQUIREMENTS = {
  bearer: [{ bearerAuth: [] }],
  apiKey: [{ apiKeyAuth: [] }],
  admin: [{ bearerAuth: [] }],
  orgRole: [{ bearerAuth: [] }],
}

// Standard error response body shared by every error status.
const ERROR_SCHEMA = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: false },
    message: { type: 'string' },
    // Validation errors include a `errors` map (from validate middleware).
    errors: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
  },
  required: ['success', 'message'],
}

// Wrap a `data` schema in the success envelope `{ success: true, data }`.
const envelope = (dataSchema) => {
  const inner = dataSchema ? zodToOpenApi(dataSchema) : {}
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: true },
      data: inner,
    },
    required: ['success', 'data'],
  }
}

// True when a Zod property schema is optional or has a default (i.e. not
// required in the OpenAPI sense). In Zod 4 these are represented as
// `def.type === 'optional'` / `'default'` wrappers around the inner schema.
const isOptionalProp = (propSchema) => {
  const t = propSchema?.def?.type
  return t === 'optional' || t === 'default'
}

// Convert a Zod "request" schema (the `{ body, query, params }` objects used by
// the validate middleware) into OpenAPI parameters + requestBody.
const buildRequest = (requestSchema) => {
  if (!requestSchema) return { parameters: [], requestBody: undefined }

  // `.shape` is a Zod getter returning `{ body?, query?, params? }`, each of
  // which is itself a `z.object(...)` whose `.shape` yields its fields.
  const shape = requestSchema.shape ?? {}
  const parameters = []

  // Path parameters — always `in: path`, required.
  if (shape.params) {
    for (const [name, propSchema] of Object.entries(shape.params.shape ?? {})) {
      parameters.push({
        name,
        in: 'path',
        required: true,
        schema: zodToOpenApi(propSchema),
      })
    }
  }

  // Query parameters — `in: query`, required only when not optional/default.
  if (shape.query) {
    for (const [name, propSchema] of Object.entries(shape.query.shape ?? {})) {
      parameters.push({
        name,
        in: 'query',
        required: !isOptionalProp(propSchema),
        schema: zodToOpenApi(propSchema),
      })
    }
  }

  // Request body — JSON.
  let requestBody
  if (shape.body) {
    requestBody = {
      required: true,
      content: { 'application/json': { schema: zodToOpenApi(shape.body) } },
    }
  }

  return { parameters, requestBody }
}

// Build a single OpenAPI operation object.
const buildOperation = (op) => {
  const { parameters, requestBody } = buildRequest(op.request)

  const responses = {}
  for (const [status, res] of Object.entries(op.responses)) {
    responses[status] = {
      description: res.description,
      ...(res.data
        ? { content: { 'application/json': { schema: envelope(res.data) } } }
        : // Error-only responses (no `data`) use the shared error schema when
          // the status is a known error code, otherwise leave the body empty.
          Number(status) >= 400
          ? { content: { 'application/json': { schema: ERROR_SCHEMA } } }
          : {}),
    }
  }

  const operationObject = {
    tags: [op.tag],
    summary: op.summary,
    description: op.description,
    parameters,
    responses,
  }
  if (requestBody) operationObject.requestBody = requestBody

  if (op.security && SECURITY_REQUIREMENTS[op.security]) {
    operationObject.security = SECURITY_REQUIREMENTS[op.security]
  }

  return operationObject
}

// Rewrite `/api/orgs/:orgId` → `/api/orgs/{orgId}` for OpenAPI.
const toOpenApiPath = (path) => path.replace(/:(\w+)/g, '{$1}')

// Build the full OpenAPI document. Memoised so repeated calls are cheap.
let cachedSpec = null

export const buildSpec = (overrides = {}) => {
  if (cachedSpec) return cachedSpec

  const paths = {}
  const tagSet = new Set()

  for (const op of operations) {
    tagSet.add(op.tag)
    const oaPath = toOpenApiPath(op.path)
    paths[oaPath] ??= {}
    paths[oaPath][op.method.toLowerCase()] = buildOperation(op)
  }

  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'SaaS Backend Boilerplate API',
      version: '1.0.0',
      description:
        'Production-ready Express 5 + Prisma SaaS backend. Authentication, multi-tenancy, billing, RBAC, audit logging, and more.\n\nAll protected endpoints require a `Authorization: Bearer <jwt>` header. API-key-authenticated endpoints use `X-API-Key`.',
    },
    servers: [{ url: process.env.APP_URL || 'http://localhost:3000' }],
    tags: [...tagSet].sort().map((name) => ({ name, description: `${name} endpoints` })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT access token obtained from `/api/auth/login` or `/api/auth/register`.',
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key prefixed with `sk_`, created via `/api/api-keys`.',
        },
      },
    },
    ...overrides,
  }

  cachedSpec = spec
  return spec
}

// Reset the cache — used by tests to pick up env changes (e.g. APP_URL).
export const resetSpecCache = () => {
  cachedSpec = null
}
