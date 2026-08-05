// Central OpenAPI route registry.
//
// Every API operation is declared here with:
//   - method / path / tag / summary / description
//   - security: null (public), 'bearer' (JWT), 'apiKey' (X-API-Key), 'admin'
//     (JWT + ADMIN role), or 'orgRole' (JWT + tenant membership — role notes go
//     in the description)
//   - request: the *actual* Zod validation schema used by the route (imported
//     from the owning module) — the builder converts its body/query/params into
//     OpenAPI parameters & requestBody automatically
//   - responses: status → { description, data? } where `data` is a Zod schema
//     for the `data` field of the `{ success, data }` envelope
//
// Keeping this in one place makes the spec a single source of truth that stays
// in sync with the real validation schemas (the "auto-generated from Zod" part).
import { z } from 'zod'
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  changeEmailSchema,
  logoutSchema,
  googleLoginSchema,
} from '../auth/auth.schema.js'
import {
  enableTwoFactorSchema,
  disableTwoFactorSchema,
  verifyTwoFactorSchema,
} from '../auth/twofa.schema.js'
import { deleteAccountSchema } from '../gdpr/gdpr.schema.js'
import {
  createOrgSchema,
  updateOrgSchema,
  orgIdParamSchema,
  updateMemberSchema,
  removeMemberSchema,
  listOrgsSchema,
  listMembersSchema,
} from '../org/org.schema.js'
import {
  createInvitationSchema,
  listInvitationsSchema,
  cancelInvitationSchema,
  acceptInvitationSchema,
  declineInvitationSchema,
  listMyInvitationsSchema,
} from '../org/invitation.schema.js'
import { listUsersSchema, userIdParamSchema, updateUserSchema } from '../admin/admin.schema.js'
import { checkoutSchema, portalSchema, listPlansSchema } from '../billing/billing.schema.js'
import {
  createApiKeySchema,
  keyIdParamSchema,
  listApiKeysSchema,
} from '../apikey/apikey.schema.js'
import { listSessionsSchema, sessionIdParamSchema } from '../session/session.schema.js'
import { listAuditLogsSchema, listUserAuditLogsSchema } from '../audit/audit.schema.js'
import {
  listNotificationsSchema,
  notificationIdSchema,
  updatePreferencesSchema,
} from '../notification/notification.schema.js'
import {
  createFlagSchema,
  updateFlagSchema,
  flagIdParamSchema,
  listFlagsSchema,
  setOverrideSchema,
  overrideParamSchema,
  evaluateFlagSchema,
} from '../featureflag/featureflag.schema.js'
import * as s from './docs.schemas.js'

// ---------------------------------------------------------------------------
// Response helpers — keep the operation table below terse & readable.
// `data` schemas are wrapped in the standard `{ success: true, data }` envelope
// by the builder. Error responses share a single shape across the API.
// ---------------------------------------------------------------------------

const ok = (data, description = 'OK') => ({ 200: { description, data } })
const created = (data, description = 'Created') => ({ 201: { description, data } })
const noData = (description = 'OK') => ({ 200: { description, data: s.messageData } })

const errors = (...codes) =>
  Object.fromEntries(
    codes.map((code) => [
      code,
      { description: ERROR_MESSAGES[code] ?? 'Error' },
    ]),
  )

const ERROR_MESSAGES = {
  400: 'Validation error or bad request',
  401: 'Authentication required or invalid credentials',
  403: 'Forbidden — insufficient permissions',
  404: 'Resource not found',
  409: 'Conflict — resource already exists',
  410: 'Gone — token expired',
  423: 'Account locked due to too many failed attempts',
  503: 'Service unavailable',
}

// ---------------------------------------------------------------------------
// Operation table
// ---------------------------------------------------------------------------

export const operations = [
  // --- Health ------------------------------------------------------------
  {
    method: 'GET',
    path: '/health',
    tag: 'Health',
    summary: 'Liveness probe',
    description: 'Cheap liveness check with no DB dependency. Rate-limited.',
    security: null,
    responses: {
      200: { description: 'Service is live', data: z.object({ status: z.string(), timestamp: s.isoDate }) },
    },
  },
  {
    method: 'GET',
    path: '/health/ready',
    tag: 'Health',
    summary: 'Readiness probe',
    description: 'Pings the database to verify the service is ready to serve traffic.',
    security: null,
    responses: {
      200: { description: 'Service is ready', data: z.object({ status: z.string(), timestamp: s.isoDate }) },
      503: { description: 'Database unavailable', data: z.object({ status: z.string(), message: z.string() }) },
    },
  },

  // --- Auth --------------------------------------------------------------
  {
    method: 'POST',
    path: '/api/auth/register',
    tag: 'Auth',
    summary: 'Register a new user',
    description: 'Creates a user, issues access + refresh tokens, and queues a verification email.',
    security: null,
    request: registerSchema,
    responses: {
      ...created(s.authTokens, 'User registered'),
      ...errors(400, 409),
    },
  },
  {
    method: 'POST',
    path: '/api/auth/login',
    tag: 'Auth',
    summary: 'Log in',
    description:
      'Validates credentials and returns tokens. When 2FA is enabled, returns `twoFactorRequired: true` with a challenge token instead of JWTs. Accounts are temporarily locked after 5 failed attempts.',
    security: null,
    request: loginSchema,
    responses: {
      ...ok(s.loginData, 'Tokens or 2FA challenge'),
      ...errors(400, 401, 423),
    },
  },
  {
    method: 'POST',
    path: '/api/auth/refresh',
    tag: 'Auth',
    summary: 'Refresh access token',
    description: 'Exchanges a valid refresh token for a new access/refresh token pair (rotation).',
    security: null,
    request: refreshSchema,
    responses: { ...ok(s.authTokens, 'New token pair'), ...errors(400, 401) },
  },
  {
    method: 'POST',
    path: '/api/auth/verify-email',
    tag: 'Auth',
    summary: 'Verify email address',
    security: null,
    request: verifyEmailSchema,
    responses: { ...noData('Email verified'), ...errors(400) },
  },
  {
    method: 'POST',
    path: '/api/auth/resend-verification',
    tag: 'Auth',
    summary: 'Resend verification email',
    security: null,
    request: resendVerificationSchema,
    responses: { ...noData('Verification email queued'), ...errors(400, 404) },
  },
  {
    method: 'POST',
    path: '/api/auth/forgot-password',
    tag: 'Auth',
    summary: 'Request a password reset',
    description: 'Always returns 200 regardless of whether the email exists (prevents enumeration).',
    security: null,
    request: forgotPasswordSchema,
    responses: { ...noData('Reset email queued if the account exists'), ...errors(400) },
  },
  {
    method: 'POST',
    path: '/api/auth/reset-password',
    tag: 'Auth',
    summary: 'Reset password with a token',
    security: null,
    request: resetPasswordSchema,
    responses: { ...noData('Password reset'), ...errors(400, 410) },
  },
  {
    method: 'GET',
    path: '/api/auth/google',
    tag: 'Auth',
    summary: 'Get Google OAuth authorization URL',
    security: null,
    responses: { ...ok(s.googleAuthUrlData, 'OAuth URL'), ...errors(500) },
  },
  {
    method: 'POST',
    path: '/api/auth/google',
    tag: 'Auth',
    summary: 'Log in with Google',
    description: 'Exchanges a Google authorization code for tokens. Links to an existing account when emails match.',
    security: null,
    request: googleLoginSchema,
    responses: { ...ok(s.authTokens, 'Tokens issued'), ...errors(400, 401) },
  },
  {
    method: 'POST',
    path: '/api/auth/2fa/verify',
    tag: 'Auth',
    summary: 'Complete 2FA login',
    description: 'Submits a TOTP or backup code against a challenge token to finish login.',
    security: null,
    request: verifyTwoFactorSchema,
    responses: { ...ok(s.authTokens, 'Tokens issued'), ...errors(400, 401) },
  },
  {
    method: 'POST',
    path: '/api/auth/2fa/setup',
    tag: 'Auth',
    summary: 'Start 2FA setup',
    description: 'Generates a TOTP secret and QR code. 2FA is not enabled until `/2fa/enable` is called.',
    security: 'bearer',
    responses: { ...ok(s.twoFactorSetupData, 'Secret + QR code'), ...errors(401) },
  },
  {
    method: 'POST',
    path: '/api/auth/2fa/enable',
    tag: 'Auth',
    summary: 'Enable 2FA',
    description: 'Verifies the first TOTP code and enables 2FA, returning single-use backup codes.',
    security: 'bearer',
    request: enableTwoFactorSchema,
    responses: { ...ok(s.twoFactorEnableData, '2FA enabled with backup codes'), ...errors(400, 401) },
  },
  {
    method: 'POST',
    path: '/api/auth/2fa/disable',
    tag: 'Auth',
    summary: 'Disable 2FA',
    security: 'bearer',
    request: disableTwoFactorSchema,
    responses: { ...noData('2FA disabled'), ...errors(400, 401) },
  },
  {
    method: 'POST',
    path: '/api/auth/change-password',
    tag: 'Auth',
    summary: 'Change password',
    security: 'bearer',
    request: changePasswordSchema,
    responses: { ...noData('Password changed'), ...errors(400, 401) },
  },
  {
    method: 'POST',
    path: '/api/auth/change-email',
    tag: 'Auth',
    summary: 'Change email address',
    security: 'bearer',
    request: changeEmailSchema,
    responses: { ...noData('Email changed'), ...errors(400, 401, 409) },
  },
  {
    method: 'POST',
    path: '/api/auth/logout',
    tag: 'Auth',
    summary: 'Log out',
    description: 'Revokes the supplied refresh token (if any).',
    security: 'bearer',
    request: logoutSchema,
    responses: { ...noData('Logged out'), ...errors(401) },
  },
  {
    method: 'GET',
    path: '/api/auth/me',
    tag: 'Auth',
    summary: 'Get current user',
    security: 'bearer',
    responses: { ...ok(z.object({ user: s.user }), 'Current user'), ...errors(401) },
  },
  {
    method: 'GET',
    path: '/api/auth/data-export',
    tag: 'GDPR',
    summary: 'Export all account data',
    description: 'Returns the authenticated user’s full data as JSON (GDPR data portability).',
    security: 'bearer',
    responses: { ...ok(s.dataExport, 'Account data export'), ...errors(401) },
  },
  {
    method: 'DELETE',
    path: '/api/auth/account',
    tag: 'GDPR',
    summary: 'Delete account',
    description:
      'Hard-deletes the account after password verification. Cascades to tokens, memberships, subscriptions, API keys, and notifications. Prevents the last admin from deleting.',
    security: 'bearer',
    request: deleteAccountSchema,
    responses: { ...noData('Account deleted'), ...errors(400, 401, 403) },
  },

  // --- Organizations -----------------------------------------------------
  {
    method: 'POST',
    path: '/api/organizations',
    tag: 'Organizations',
    summary: 'Create an organization',
    description: 'Creates an org and adds the caller as OWNER.',
    security: 'bearer',
    request: createOrgSchema,
    responses: { ...created(z.object({ organization: s.organization })), ...errors(400, 401, 409) },
  },
  {
    method: 'GET',
    path: '/api/organizations',
    tag: 'Organizations',
    summary: 'List my organizations',
    security: 'bearer',
    request: listOrgsSchema,
    responses: {
      ...ok(z.object({ organizations: z.array(s.organizationWithRole), pagination: s.pagination })),
      ...errors(401),
    },
  },
  {
    method: 'GET',
    path: '/api/organizations/{orgId}',
    tag: 'Organizations',
    summary: 'Get an organization',
    security: 'orgRole',
    request: orgIdParamSchema,
    responses: { ...ok(z.object({ organization: s.organization })), ...errors(401, 403, 404) },
  },
  {
    method: 'PATCH',
    path: '/api/organizations/{orgId}',
    tag: 'Organizations',
    summary: 'Update an organization',
    description: 'Requires OWNER or ADMIN role.',
    security: 'orgRole',
    request: updateOrgSchema,
    responses: { ...ok(z.object({ organization: s.organization })), ...errors(400, 401, 403, 404, 409) },
  },
  {
    method: 'DELETE',
    path: '/api/organizations/{orgId}',
    tag: 'Organizations',
    summary: 'Soft-delete an organization',
    description: 'Requires OWNER role. Sets `deletedAt` instead of hard-deleting.',
    security: 'orgRole',
    request: orgIdParamSchema,
    responses: { ...noData('Organization deleted'), ...errors(401, 403, 404) },
  },
  {
    method: 'POST',
    path: '/api/organizations/{orgId}/restore',
    tag: 'Organizations',
    summary: 'Restore a soft-deleted organization',
    description: 'Requires OWNER role.',
    security: 'orgRole',
    request: orgIdParamSchema,
    responses: { ...noData('Organization restored'), ...errors(401, 403, 404) },
  },
  {
    method: 'GET',
    path: '/api/organizations/{orgId}/members',
    tag: 'Organizations',
    summary: 'List organization members',
    security: 'orgRole',
    request: listMembersSchema,
    responses: {
      ...ok(z.object({ members: z.array(s.member), pagination: s.pagination })),
      ...errors(401, 403, 404),
    },
  },
  {
    method: 'PATCH',
    path: '/api/organizations/{orgId}/members/{userId}',
    tag: 'Organizations',
    summary: 'Update a member role',
    description: 'Requires OWNER or ADMIN role. Cannot change the owner’s role.',
    security: 'orgRole',
    request: updateMemberSchema,
    responses: { ...ok(z.object({ member: s.member })), ...errors(400, 401, 403, 404) },
  },
  {
    method: 'DELETE',
    path: '/api/organizations/{orgId}/members/{userId}',
    tag: 'Organizations',
    summary: 'Remove a member',
    description: 'Requires OWNER or ADMIN role. Cannot remove the owner.',
    security: 'orgRole',
    request: removeMemberSchema,
    responses: { ...noData('Member removed'), ...errors(401, 403, 404) },
  },
  {
    method: 'POST',
    path: '/api/organizations/{orgId}/invitations',
    tag: 'Invitations',
    summary: 'Invite a member by email',
    description: 'Requires OWNER or ADMIN role. Sends an invitation email via the queue.',
    security: 'orgRole',
    request: createInvitationSchema,
    responses: { ...created(z.object({ invitation: s.invitation })), ...errors(400, 401, 403, 404, 409) },
  },
  {
    method: 'GET',
    path: '/api/organizations/{orgId}/invitations',
    tag: 'Invitations',
    summary: 'List an organization’s invitations',
    description: 'Requires OWNER or ADMIN role.',
    security: 'orgRole',
    request: listInvitationsSchema,
    responses: {
      ...ok(z.object({ invitations: z.array(s.invitation), pagination: s.pagination })),
      ...errors(401, 403, 404),
    },
  },
  {
    method: 'DELETE',
    path: '/api/organizations/{orgId}/invitations/{invitationId}',
    tag: 'Invitations',
    summary: 'Cancel a pending invitation',
    description: 'Requires OWNER or ADMIN role.',
    security: 'orgRole',
    request: cancelInvitationSchema,
    responses: { ...noData('Invitation canceled'), ...errors(401, 403, 404) },
  },

  // --- Invitations (user-scoped) -----------------------------------------
  {
    method: 'GET',
    path: '/api/invitations/me',
    tag: 'Invitations',
    summary: 'List my pending invitations',
    security: 'bearer',
    request: listMyInvitationsSchema,
    responses: {
      ...ok(z.object({ invitations: z.array(s.invitation), pagination: s.pagination })),
      ...errors(401),
    },
  },
  {
    method: 'POST',
    path: '/api/invitations/accept',
    tag: 'Invitations',
    summary: 'Accept an invitation',
    security: 'bearer',
    request: acceptInvitationSchema,
    responses: { ...ok(z.object({ invitation: s.invitation })), ...errors(400, 401, 404, 410) },
  },
  {
    method: 'POST',
    path: '/api/invitations/decline',
    tag: 'Invitations',
    summary: 'Decline an invitation',
    security: 'bearer',
    request: declineInvitationSchema,
    responses: { ...noData('Invitation declined'), ...errors(400, 401, 404, 410) },
  },

  // --- Admin -------------------------------------------------------------
  {
    method: 'GET',
    path: '/api/admin/users',
    tag: 'Admin',
    summary: 'List users (admin)',
    description: 'Paginated list with search, role/status filters, and sorting.',
    security: 'admin',
    request: listUsersSchema,
    responses: {
      ...ok(z.object({ users: z.array(s.user), pagination: s.pagination })),
      ...errors(401, 403),
    },
  },
  {
    method: 'GET',
    path: '/api/admin/users/{userId}',
    tag: 'Admin',
    summary: 'Get a user (admin)',
    security: 'admin',
    request: userIdParamSchema,
    responses: { ...ok(z.object({ user: s.user })), ...errors(401, 403, 404) },
  },
  {
    method: 'PATCH',
    path: '/api/admin/users/{userId}',
    tag: 'Admin',
    summary: 'Update a user (admin)',
    description: 'Update name, role, ban, or suspend a user.',
    security: 'admin',
    request: updateUserSchema,
    responses: { ...ok(z.object({ user: s.user })), ...errors(400, 401, 403, 404) },
  },
  {
    method: 'DELETE',
    path: '/api/admin/users/{userId}',
    tag: 'Admin',
    summary: 'Soft-delete a user (admin)',
    security: 'admin',
    request: userIdParamSchema,
    responses: { ...noData('User deleted'), ...errors(401, 403, 404) },
  },
  {
    method: 'POST',
    path: '/api/admin/users/{userId}/restore',
    tag: 'Admin',
    summary: 'Restore a soft-deleted user (admin)',
    security: 'admin',
    request: userIdParamSchema,
    responses: { ...noData('User restored'), ...errors(401, 403, 404) },
  },

  // --- Billing -----------------------------------------------------------
  {
    method: 'GET',
    path: '/api/billing/plans',
    tag: 'Billing',
    summary: 'List available plans',
    description: 'Public endpoint — no authentication required.',
    security: null,
    request: listPlansSchema,
    responses: {
      ...ok(z.object({ plans: z.array(s.plan), pagination: s.pagination })),
      ...errors(400),
    },
  },
  {
    method: 'POST',
    path: '/api/billing/webhook',
    tag: 'Billing',
    summary: 'Stripe webhook',
    description:
      'Receives Stripe events. The raw body is verified against `STRIPE_WEBHOOK_SECRET`. Not meant to be called by clients.',
    security: null,
    responses: { 200: { description: 'Webhook received' } },
  },
  {
    method: 'GET',
    path: '/api/billing/subscription',
    tag: 'Billing',
    summary: 'Get the current subscription',
    security: 'bearer',
    responses: { ...ok(z.object({ subscription: s.subscription })), ...errors(401, 404) },
  },
  {
    method: 'POST',
    path: '/api/billing/checkout',
    tag: 'Billing',
    summary: 'Create a Stripe Checkout session',
    security: 'bearer',
    request: checkoutSchema,
    responses: { ...ok(s.checkoutData, 'Checkout URL'), ...errors(400, 401) },
  },
  {
    method: 'POST',
    path: '/api/billing/portal',
    tag: 'Billing',
    summary: 'Create a Stripe Billing Portal session',
    security: 'bearer',
    request: portalSchema,
    responses: { ...ok(s.portalData, 'Portal URL'), ...errors(400, 401) },
  },
  {
    method: 'POST',
    path: '/api/billing/cancel',
    tag: 'Billing',
    summary: 'Cancel the current subscription',
    security: 'bearer',
    responses: { ...ok(z.object({ subscription: s.subscription })), ...errors(401, 404) },
  },

  // --- API keys ----------------------------------------------------------
  {
    method: 'POST',
    path: '/api/api-keys',
    tag: 'API Keys',
    summary: 'Create an API key',
    description: 'Returns the raw key only once (prefixed with `sk_`).',
    security: 'bearer',
    request: createApiKeySchema,
    responses: { ...created(z.object({ apiKey: s.apiKeyCreated })), ...errors(400, 401) },
  },
  {
    method: 'GET',
    path: '/api/api-keys',
    tag: 'API Keys',
    summary: 'List API keys',
    security: 'bearer',
    request: listApiKeysSchema,
    responses: {
      ...ok(z.object({ apiKeys: z.array(s.apiKey), pagination: s.pagination })),
      ...errors(401),
    },
  },
  {
    method: 'GET',
    path: '/api/api-keys/{keyId}',
    tag: 'API Keys',
    summary: 'Get an API key',
    security: 'bearer',
    request: keyIdParamSchema,
    responses: { ...ok(z.object({ apiKey: s.apiKey })), ...errors(401, 404) },
  },
  {
    method: 'POST',
    path: '/api/api-keys/{keyId}/revoke',
    tag: 'API Keys',
    summary: 'Revoke an API key',
    security: 'bearer',
    request: keyIdParamSchema,
    responses: { ...ok(z.object({ apiKey: s.apiKey })), ...errors(401, 404) },
  },
  {
    method: 'DELETE',
    path: '/api/api-keys/{keyId}',
    tag: 'API Keys',
    summary: 'Soft-delete an API key',
    security: 'bearer',
    request: keyIdParamSchema,
    responses: { ...noData('API key deleted'), ...errors(401, 404) },
  },
  {
    method: 'POST',
    path: '/api/api-keys/{keyId}/restore',
    tag: 'API Keys',
    summary: 'Restore a soft-deleted API key',
    security: 'bearer',
    request: keyIdParamSchema,
    responses: { ...ok(z.object({ apiKey: s.apiKey })), ...errors(401, 404) },
  },

  // --- Sessions ----------------------------------------------------------
  {
    method: 'GET',
    path: '/api/sessions',
    tag: 'Sessions',
    summary: 'List active sessions',
    security: 'bearer',
    request: listSessionsSchema,
    responses: {
      ...ok(z.object({ sessions: z.array(s.session), pagination: s.pagination })),
      ...errors(401),
    },
  },
  {
    method: 'POST',
    path: '/api/sessions/{sessionId}/revoke',
    tag: 'Sessions',
    summary: 'Revoke a session',
    security: 'bearer',
    request: sessionIdParamSchema,
    responses: { ...noData('Session revoked'), ...errors(401, 404) },
  },
  {
    method: 'POST',
    path: '/api/sessions/revoke-all',
    tag: 'Sessions',
    summary: 'Revoke all sessions',
    security: 'bearer',
    responses: { ...noData('All sessions revoked'), ...errors(401) },
  },

  // --- Audit -------------------------------------------------------------
  {
    method: 'GET',
    path: '/api/audit',
    tag: 'Audit',
    summary: 'List audit logs (admin)',
    description: 'Full audit log access with action/user/target/org filters.',
    security: 'admin',
    request: listAuditLogsSchema,
    responses: {
      ...ok(z.object({ auditLogs: z.array(s.auditLog), pagination: s.pagination })),
      ...errors(401, 403),
    },
  },
  {
    method: 'GET',
    path: '/api/audit/me',
    tag: 'Audit',
    summary: 'List my audit logs',
    security: 'bearer',
    request: listUserAuditLogsSchema,
    responses: {
      ...ok(z.object({ auditLogs: z.array(s.auditLog), pagination: s.pagination })),
      ...errors(401),
    },
  },

  // --- Notifications -----------------------------------------------------
  {
    method: 'GET',
    path: '/api/notifications',
    tag: 'Notifications',
    summary: 'List notifications',
    description: 'Supports filtering by type, unread-only, and search; includes an unread count.',
    security: 'bearer',
    request: listNotificationsSchema,
    responses: {
      ...ok(
        z.object({
          notifications: z.array(s.notification),
          pagination: s.pagination,
          unreadCount: z.number().int(),
        }),
      ),
      ...errors(401),
    },
  },
  {
    method: 'PATCH',
    path: '/api/notifications/read-all',
    tag: 'Notifications',
    summary: 'Mark all notifications as read',
    security: 'bearer',
    responses: { ...noData('All notifications marked as read'), ...errors(401) },
  },
  {
    method: 'PATCH',
    path: '/api/notifications/{notificationId}/read',
    tag: 'Notifications',
    summary: 'Mark a notification as read',
    security: 'bearer',
    request: notificationIdSchema,
    responses: { ...ok(z.object({ notification: s.notification })), ...errors(401, 404) },
  },
  {
    method: 'DELETE',
    path: '/api/notifications/{notificationId}',
    tag: 'Notifications',
    summary: 'Delete a notification',
    security: 'bearer',
    request: notificationIdSchema,
    responses: { ...noData('Notification deleted'), ...errors(401, 404) },
  },
  {
    method: 'GET',
    path: '/api/notifications/preferences',
    tag: 'Notifications',
    summary: 'Get notification preferences',
    security: 'bearer',
    responses: { ...ok(z.object({ preferences: s.notificationPreferences })), ...errors(401) },
  },
  {
    method: 'PATCH',
    path: '/api/notifications/preferences',
    tag: 'Notifications',
    summary: 'Update notification preferences',
    security: 'bearer',
    request: updatePreferencesSchema,
    responses: { ...ok(z.object({ preferences: s.notificationPreferences })), ...errors(400, 401) },
  },

  // --- Feature flags -----------------------------------------------------
  {
    method: 'GET',
    path: '/api/feature-flags/evaluate',
    tag: 'Feature Flags',
    summary: 'Evaluate a feature flag',
    description: 'Resolves an org override (if any) against the flag default. Any authenticated user.',
    security: 'bearer',
    request: evaluateFlagSchema,
    responses: { ...ok(s.evaluateFlagData, 'Evaluation result'), ...errors(400, 401, 404) },
  },
  {
    method: 'POST',
    path: '/api/feature-flags',
    tag: 'Feature Flags',
    summary: 'Create a feature flag (admin)',
    security: 'admin',
    request: createFlagSchema,
    responses: { ...created(z.object({ flag: s.featureFlag })), ...errors(400, 401, 403, 409) },
  },
  {
    method: 'GET',
    path: '/api/feature-flags',
    tag: 'Feature Flags',
    summary: 'List feature flags (admin)',
    security: 'admin',
    request: listFlagsSchema,
    responses: {
      ...ok(z.object({ flags: z.array(s.featureFlag), pagination: s.pagination })),
      ...errors(401, 403),
    },
  },
  {
    method: 'GET',
    path: '/api/feature-flags/{flagId}',
    tag: 'Feature Flags',
    summary: 'Get a feature flag (admin)',
    security: 'admin',
    request: flagIdParamSchema,
    responses: { ...ok(z.object({ flag: s.featureFlag })), ...errors(401, 403, 404) },
  },
  {
    method: 'PATCH',
    path: '/api/feature-flags/{flagId}',
    tag: 'Feature Flags',
    summary: 'Update a feature flag (admin)',
    security: 'admin',
    request: updateFlagSchema,
    responses: { ...ok(z.object({ flag: s.featureFlag })), ...errors(400, 401, 403, 404) },
  },
  {
    method: 'DELETE',
    path: '/api/feature-flags/{flagId}',
    tag: 'Feature Flags',
    summary: 'Delete a feature flag (admin)',
    security: 'admin',
    request: flagIdParamSchema,
    responses: { ...noData('Flag deleted'), ...errors(401, 403, 404) },
  },
  {
    method: 'POST',
    path: '/api/feature-flags/{flagId}/overrides/{orgId}',
    tag: 'Feature Flags',
    summary: 'Set an org override (admin)',
    security: 'admin',
    request: setOverrideSchema,
    responses: { ...ok(z.object({ override: s.featureFlagOverride })), ...errors(400, 401, 403, 404) },
  },
  {
    method: 'DELETE',
    path: '/api/feature-flags/{flagId}/overrides/{orgId}',
    tag: 'Feature Flags',
    summary: 'Remove an org override (admin)',
    security: 'admin',
    request: overrideParamSchema,
    responses: { ...noData('Override removed'), ...errors(401, 403, 404) },
  },
]
