// Reusable Zod response schemas used by the OpenAPI route registry.
//
// These model the JSON actually returned by the controllers (the `data` payload
// inside the `{ success, data }` envelope). They are intentionally pragmatic —
// they describe the shape clients rely on rather than every internal Prisma
// column. Request validation schemas live next to each module and are imported
// directly by the registry; this file only covers *responses*.
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Primitives & shared fragments
// ---------------------------------------------------------------------------

export const isoDate = z.string().datetime()

export const pagination = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
})

// A generic `{ message }` payload — used by delete/restore/logout endpoints.
export const messageData = z.object({ message: z.string() })

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const user = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['USER', 'ADMIN']),
  createdAt: isoDate,
})

export const authTokens = z.object({
  user,
  accessToken: z.string(),
  refreshToken: z.string(),
})

// Login may short-circuit with a 2FA challenge instead of returning tokens.
export const loginData = z.object({
  twoFactorRequired: z.boolean().optional(),
  user: user.optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  challengeToken: z.string().optional(),
})

export const googleAuthUrlData = z.object({
  url: z.string().url(),
})

export const twoFactorSetupData = z.object({
  secret: z.string(),
  qrCode: z.string(), // data-URL PNG
})

export const twoFactorEnableData = z.object({
  backupCodes: z.array(z.string()),
})

// ---------------------------------------------------------------------------
// Organizations & members
// ---------------------------------------------------------------------------

export const organization = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  ownerId: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
})

// List endpoint folds the caller's membership `role` onto each org.
export const organizationWithRole = organization.extend({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
})

export const member = z.object({
  id: z.string(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
  createdAt: isoDate,
  user: z.object({ id: z.string(), name: z.string(), email: z.string().email() }),
})

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const plan = z.object({
  id: z.string(),
  name: z.string(),
  priceCents: z.number().int(),
  interval: z.enum(['MONTH', 'YEAR']),
  stripePriceId: z.string().nullable(),
  createdAt: isoDate,
})

export const subscription = z.object({
  id: z.string(),
  status: z.enum(['ACTIVE', 'CANCELED', 'PAST_DUE', 'TRIALING']),
  plan,
  currentPeriodStart: isoDate.nullable(),
  currentPeriodEnd: isoDate.nullable(),
  createdAt: isoDate,
})

export const checkoutData = z.object({
  url: z.string().url(),
})

export const portalData = z.object({
  url: z.string().url(),
})

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export const apiKey = z.object({
  id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
  expiresAt: isoDate.nullable(),
  lastUsedAt: isoDate.nullable(),
  createdAt: isoDate,
  revokedAt: isoDate.nullable(),
})

// The raw key is only returned once, at creation time.
export const apiKeyCreated = apiKey.extend({ key: z.string() })

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const session = z.object({
  id: z.string(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  expiresAt: isoDate,
  createdAt: isoDate,
  updatedAt: isoDate,
})

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const auditLog = z.object({
  id: z.string(),
  action: z.string(),
  userId: z.string().nullable(),
  targetUserId: z.string().nullable(),
  organizationId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: isoDate,
})

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export const invitation = z.object({
  id: z.string(),
  email: z.string().email(),
  role: z.enum(['ADMIN', 'MEMBER']),
  status: z.enum(['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELED', 'EXPIRED']),
  expiresAt: isoDate,
  createdAt: isoDate,
  organizationId: z.string(),
  invitedById: z.string(),
})

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notification = z.object({
  id: z.string(),
  type: z.enum(['SYSTEM', 'ORGANIZATION', 'BILLING', 'SECURITY', 'TEAM']),
  title: z.string(),
  message: z.string(),
  readAt: isoDate.nullable(),
  createdAt: isoDate,
})

export const notificationPreferences = z.object({
  emailEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  inAppEnabled: z.boolean(),
  mutedTypes: z.array(z.enum(['SYSTEM', 'ORGANIZATION', 'BILLING', 'SECURITY', 'TEAM'])),
})

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

export const featureFlag = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.enum(['BOOLEAN', 'PERCENTAGE', 'PLAN']),
  value: z.unknown(),
  active: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
})

export const featureFlagOverride = z.object({
  id: z.string(),
  flagId: z.string(),
  organizationId: z.string(),
  enabled: z.boolean(),
  value: z.unknown(),
  createdAt: isoDate,
  updatedAt: isoDate,
})

export const evaluateFlagData = z.object({
  key: z.string(),
  enabled: z.boolean(),
  value: z.unknown(),
  source: z.enum(['override', 'default']),
})

// ---------------------------------------------------------------------------
// GDPR
// ---------------------------------------------------------------------------

// Data export is a large aggregate — modelled as an opaque object.
export const dataExport = z.record(z.string(), z.unknown())
