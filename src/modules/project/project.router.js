import { Router } from 'express'
import { validate } from '../../middleware/validate.middleware.js'
import { authenticate, requireVerifiedEmail } from '../../middleware/auth.middleware.js'
import { requireTenant, requireOrgRole } from '../../middleware/tenant.middleware.js'
import { requireSubscription, requirePlan } from '../../middleware/subscription.middleware.js'
import { requireFeatureFlag } from '../../middleware/featureflag.middleware.js'
import { authenticateApiKey, requireScope } from '../../middleware/apiKey.middleware.js'
import {
  listProjectsSchema,
  projectIdSchema,
  createProjectSchema,
  updateProjectSchema,
} from './project.schema.js'
import * as ctrl from './project.controller.js'

// ─────────────────────────────────────────────────────────────────────────────
// Worked example: the reference wiring for a tenant-scoped resource.
//
// This module exists to show every guard composed on real routes served by the
// real app, not to be a compelling product feature. It is deliberately the only
// place in the codebase that uses `requireSubscription`, `requirePlan`,
// `requireFeatureFlag`, `requireScope` and `requireVerifiedEmail` on live
// routes — copy the chains below for your own resources, then delete this
// module along with the Project model.
//
// Guards compose in a fixed order, each one depending on what the previous
// attached to the request:
//
//   authenticate          → req.user     (JWT, tokenVersion, ban/suspend/soft-delete)
//   requireVerifiedEmail  →              (needs req.user)
//   requireTenant         → req.tenant   (needs req.user + :orgId; proves membership)
//   requireOrgRole(...)   →              (needs req.tenant)
//   requireSubscription   → req.subscription
//   requirePlan(...)      →              (needs req.subscription)
//   requireFeatureFlag(k) → req.featureFlag  (reads req.tenant + req.subscription)
//
// Getting that order wrong is the classic authorization bug: a role check that
// runs before the tenant is resolved is checking a role in no particular org.
// ─────────────────────────────────────────────────────────────────────────────

// mergeParams is required — :orgId lives on the parent mount path, and both
// `requireTenant` and the schemas read it from req.params.
const router = Router({ mergeParams: true })

// Applies to every route below. Email verification is enforced here rather than
// per-route so that a new route added to this file cannot forget it.
router.use(authenticate, requireVerifiedEmail, requireTenant)

// ── Reads: any member of the organization ───────────────────────────────────
router.get('/', validate(listProjectsSchema), ctrl.listProjects)

// Registered before '/:projectId' — Express matches in declaration order, so a
// literal segment must come first or it is swallowed by the parameter route.
//
// The paywall stack: an active subscription, on a specific plan, with the flag
// switched on. `requireFeatureFlag` treats a missing or inactive flag as
// disabled, so this route stays closed until `projects_export` is seeded —
// which is why the CRUD routes above are deliberately not flag-gated.
router.get(
  '/export',
  validate(listProjectsSchema),
  requireSubscription,
  requirePlan('Pro', 'Enterprise'),
  requireFeatureFlag('projects_export'),
  ctrl.exportProjects,
)

router.get('/:projectId', validate(projectIdSchema), ctrl.getProject)

// ── Writes: org admins and owners ───────────────────────────────────────────
router.post(
  '/',
  requireOrgRole('OWNER', 'ADMIN'),
  validate(createProjectSchema),
  ctrl.createProject,
)

router.patch(
  '/:projectId',
  requireOrgRole('OWNER', 'ADMIN'),
  validate(updateProjectSchema),
  ctrl.updateProject,
)

// Destructive: owner only.
router.delete('/:projectId', requireOrgRole('OWNER'), validate(projectIdSchema), ctrl.deleteProject)

export default router

// ─────────────────────────────────────────────────────────────────────────────
// Programmatic access, mounted separately at
// /api/integrations/organizations/:orgId/projects.
//
// API keys are a different authentication scheme, not an alternative header on
// the same routes: `authenticateApiKey` replaces `authenticate` and the caller
// is a machine, so email verification and the interactive paywall do not apply.
// Authorization still does — `requireTenant` runs identically, so a key cannot
// read another tenant's projects, and `requireScope` narrows what the key may
// do beyond what its owner may do.
// ─────────────────────────────────────────────────────────────────────────────
export const apiKeyRouter = Router({ mergeParams: true })

apiKeyRouter.use(authenticateApiKey, requireScope('projects:read'), requireTenant)

apiKeyRouter.get('/', validate(listProjectsSchema), ctrl.listProjects)
apiKeyRouter.get('/:projectId', validate(projectIdSchema), ctrl.getProject)
