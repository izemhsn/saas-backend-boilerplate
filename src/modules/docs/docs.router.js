// API documentation router.
//
// Mounts two endpoints:
//   GET /api/docs      → OpenAPI 3.0.3 spec as JSON (machine-consumable)
//   GET /api/docs/ui   → Swagger UI (human-consumable, interactive)
//
// Both are disabled in test mode (NODE_ENV=test) to keep the test suite
// focused and avoid loading swagger-ui-express's assets on every run.
import { Router } from 'express'
import swaggerUi from 'swagger-ui-express'
import { buildSpec } from './openapi.builder.js'

const router = Router()

const isTest = process.env.NODE_ENV === 'test'

// buildSpec() is already memoised internally (openapi.builder.js's
// `cachedSpec`, invalidated via `resetSpecCache()` for tests that flip
// APP_URL) — M17's "rebuilds the spec on every request" half was already
// fixed there. The other half, this route having no rate limiter at all, is
// fixed in app.js (docsLimiter).
router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.json(buildSpec())
})

// Swagger UI — skipped in test to avoid loading static assets.
if (!isTest) {
  router.use(
    '/ui',
    swaggerUi.serve,
    swaggerUi.setup(buildSpec(), {
      customSiteTitle: 'SaaS Boilerplate API Docs',
    }),
  )
}

export default router
