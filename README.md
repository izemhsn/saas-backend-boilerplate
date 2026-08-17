# SaaS Backend Boilerplate

[![CI](https://github.com/izemhsn/saas-backend-boilerplate/actions/workflows/ci.yml/badge.svg)](https://github.com/izemhsn/saas-backend-boilerplate/actions/workflows/ci.yml)
[![Deploy](https://github.com/izemhsn/saas-backend-boilerplate/actions/workflows/deploy.yml/badge.svg)](https://github.com/izemhsn/saas-backend-boilerplate/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Tests](https://img.shields.io/badge/tests-378%20passing-brightgreen)](https://github.com/izemhsn/saas-backend-boilerplate/actions/workflows/ci.yml)

A production-ready Express 5 + Prisma SaaS backend starter with JWT auth, 2FA, Google OAuth, Stripe billing, organizations, role-based access control, rate limiting, background jobs, i18n, and a full integration test suite.

## Features

- **Authentication** — JWT access + refresh tokens with rotation, reuse detection, and multi-session support
- **Two-factor auth** — TOTP with encrypted secret storage (AES-256-GCM), backup codes, attempt limiting, and atomic challenge claim
- **Google OAuth** — Sign in / link Google accounts with race-condition-safe user creation
- **Account security** — Password hashing (bcrypt), account lockout after 5 failed attempts, password reset, email verification
- **Organizations** — Multi-tenant orgs with roles (OWNER, ADMIN, MEMBER), invitations, and soft delete
- **Billing** — Stripe subscriptions, plans, checkout sessions, and webhook handling
- **API keys** — Scoped API keys with prefix-based identification and soft delete
- **Feature flags** — Boolean, percentage, and plan-based flags with per-org overrides
- **Admin panel** — User management (ban, suspend, delete, role change) with last-admin guards
- **GDPR compliance** — Data export (with password re-authentication) and account deletion with cascade
- **Sessions** — Active session listing and revocation
- **Audit logging** — Fire-and-forget audit trail for sensitive actions
- **Notifications** — In-app notifications with read/unread state and preference management
- **Background jobs** — BullMQ workers for email delivery and scheduled maintenance (token cleanup)
- **Rate limiting** — Per-route sensitive limiters with isolated Redis key prefixes
- **Input validation** — Zod schemas on every route, auto-generated OpenAPI 3.0 spec
- **i18n** — English + French with `Accept-Language` / `X-Lang` resolution
- **Security hardening** — Helmet, CORS enforcement, input sanitization, secret encryption at rest, non-root Docker

## Tech stack

| Category      | Technology                                                 |
| ------------- | ---------------------------------------------------------- |
| Runtime       | Node.js 24 (ESM)                                           |
| Framework     | Express 5                                                  |
| Database      | PostgreSQL 16 via Prisma ORM 7                             |
| Cache / Queue | Redis 7 (ioredis, BullMQ)                                  |
| Auth          | JWT (`jsonwebtoken`), bcrypt (`bcryptjs`), TOTP (`otplib`) |
| OAuth         | Google (`google-auth-library`)                             |
| Payments      | Stripe                                                     |
| Email         | Resend                                                     |
| Validation    | Zod 4                                                      |
| Logging       | Pino + pino-http                                           |
| Monitoring    | Sentry                                                     |
| Testing       | Vitest + Supertest (378 integration tests)                 |
| Linting       | ESLint 9 + Prettier                                        |
| Container     | Docker (multi-stage, non-root)                             |
| CI/CD         | GitHub Actions (lint → test → build → deploy)              |

## Prerequisites

- [Node.js](https://nodejs.org/) 24.16.0 (see `.nvmrc`)
- [Docker](https://www.docker.com/) (for local PostgreSQL + Redis)

If you use [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install
nvm use
```

## Quick start

```bash
git clone https://github.com/izemhsn/saas-backend-boilerplate.git
cd saas-backend-boilerplate
npm install
```

Copy the example environment file and adjust values as needed:

```bash
# macOS / Linux
cp .env.example .env

# Windows (PowerShell)
Copy-Item .env.example .env
```

Start the database and Redis:

```bash
docker compose up -d
```

Run migrations and generate the Prisma client:

```bash
npm run db:migrate
npm run db:generate
npm run db:seed   # optional — seeds plans, demo users, and sample data
```

Start the development server:

```bash
npm run dev
```

The server runs at `http://localhost:3000` by default, or the port set in `.env`.

### Background worker (optional)

Email delivery and scheduled maintenance run in a separate worker process:

```bash
npm run worker:dev
```

## Project structure

```
src/
  config/          # Database, Redis, Stripe, Google OAuth, Sentry
  i18n/            # Locale files (en, fr) + translation engine
  middleware/      # Auth, validation, i18n, sanitize, tenant, error handler
  modules/
    admin/         # Admin user management (ban, suspend, delete)
    apikey/        # API key CRUD with scoped permissions
    audit/         # Audit log querying
    auth/          # Register, login, 2FA, Google OAuth, password/email changes
    billing/       # Stripe subscriptions, plans, checkout, webhooks
    docs/          # OpenAPI 3.0 spec generation + Swagger UI
    featureflag/   # Feature flag CRUD + org overrides + evaluation
    gdpr/          # Data export (with re-auth) + account deletion
    jobs/          # BullMQ workers (email, maintenance) + cron scheduling
    notification/  # In-app notifications + preferences
    org/           # Organizations, memberships, invitations
    session/       # Active session listing + revocation
    shared/        # Email service (Resend + templates)
  utils/           # JWT, hashing, logging, query helpers, secret encryption
  app.js           # Express app (middleware chain, rate limiting, routes)
  server.js        # HTTP server + graceful shutdown + env validation
  worker.js        # Background job worker process
tests/             # Integration tests (23 files, 378 tests)
prisma/            # Schema, migrations, seed script
```

Each module follows the same pattern: `router.js` → `controller.js` → `service.js` → `schema.js`.

## Scripts

| Command                | Description                            |
| ---------------------- | -------------------------------------- |
| `npm run dev`          | Start server with hot-reload (nodemon) |
| `npm start`            | Start server                           |
| `npm run worker:dev`   | Start background worker (nodemon)      |
| `npm run worker:start` | Start background worker                |
| `npm test`             | Run test suite                         |
| `npm run test:cov`     | Run tests with coverage report         |
| `npm run lint`         | Lint with ESLint                       |
| `npm run lint:fix`     | Lint and auto-fix                      |
| `npm run format`       | Format with Prettier                   |
| `npm run format:check` | Check formatting without writing       |
| `npm run db:migrate`   | Run Prisma migrations (dev)            |
| `npm run db:deploy`    | Apply migrations (production)          |
| `npm run db:generate`  | Regenerate Prisma client               |
| `npm run db:studio`    | Open Prisma Studio                     |
| `npm run db:seed`      | Seed the database with sample data     |

## API endpoints

### Auth

| Method   | Route                           | Auth | Description                                                    |
| -------- | ------------------------------- | ---- | -------------------------------------------------------------- |
| `POST`   | `/api/auth/register`            | No   | Register — returns JWT + email verification token              |
| `POST`   | `/api/auth/login`               | No   | Login — returns JWT or 2FA challenge                           |
| `POST`   | `/api/auth/refresh`             | No   | Exchange a refresh token for a new JWT + rotated refresh token |
| `POST`   | `/api/auth/verify-email`        | No   | Verify email with token from registration                      |
| `POST`   | `/api/auth/resend-verification` | No   | Issue a new email verification token                           |
| `POST`   | `/api/auth/forgot-password`     | No   | Issue a password reset token (1h expiry)                       |
| `POST`   | `/api/auth/reset-password`      | No   | Reset password using a valid reset token                       |
| `POST`   | `/api/auth/change-password`     | Yes  | Change password (requires current password)                    |
| `POST`   | `/api/auth/change-email`        | Yes  | Change email (requires password, verified before switching)    |
| `POST`   | `/api/auth/logout`              | Yes  | Logout — see session behavior below                            |
| `GET`    | `/api/auth/me`                  | Yes  | Get current user profile                                       |
| `GET`    | `/api/auth/google`              | No   | Get Google OAuth authorization URL                             |
| `POST`   | `/api/auth/google`              | No   | Exchange Google authorization code for tokens                  |
| `POST`   | `/api/auth/2fa/setup`           | Yes  | Generate TOTP secret + QR code                                 |
| `POST`   | `/api/auth/2fa/enable`          | Yes  | Enable 2FA with valid TOTP code — returns backup codes         |
| `POST`   | `/api/auth/2fa/disable`         | Yes  | Disable 2FA (requires password)                                |
| `POST`   | `/api/auth/2fa/verify`          | No   | Complete 2FA login with TOTP code or backup code               |
| `POST`   | `/api/auth/data-export`         | Yes  | Export all user data (requires password re-authentication)     |
| `DELETE` | `/api/auth/account`             | Yes  | Delete account permanently (requires password)                 |

### Organizations

| Method   | Route                                   | Auth | Description                       |
| -------- | --------------------------------------- | ---- | --------------------------------- |
| `POST`   | `/api/organizations`                    | Yes  | Create organization               |
| `GET`    | `/api/organizations`                    | Yes  | List user's organizations         |
| `GET`    | `/api/organizations/:orgId`             | Yes  | Get organization details          |
| `PATCH`  | `/api/organizations/:orgId`             | Yes  | Update organization (OWNER/ADMIN) |
| `DELETE` | `/api/organizations/:orgId`             | Yes  | Soft-delete organization (OWNER)  |
| `GET`    | `/api/organizations/:orgId/members`     | Yes  | List members                      |
| `PATCH`  | `/api/organizations/:orgId/members/:id` | Yes  | Update member role (OWNER)        |
| `DELETE` | `/api/organizations/:orgId/members/:id` | Yes  | Remove member (OWNER/ADMIN)       |

### Invitations

| Method   | Route                          | Auth | Description                      |
| -------- | ------------------------------ | ---- | -------------------------------- |
| `POST`   | `/api/invitations`             | Yes  | Send invitation                  |
| `GET`    | `/api/invitations`             | Yes  | List invitations                 |
| `POST`   | `/api/invitations/:id/accept`  | Yes  | Accept invitation                |
| `POST`   | `/api/invitations/:id/decline` | Yes  | Decline invitation               |
| `DELETE` | `/api/invitations/:id`         | Yes  | Cancel invitation (inviter only) |

### Billing

| Method | Route                       | Auth | Description                           |
| ------ | --------------------------- | ---- | ------------------------------------- |
| `GET`  | `/api/billing/plans`        | No   | List available plans                  |
| `GET`  | `/api/billing/subscription` | Yes  | Get current subscription              |
| `POST` | `/api/billing/checkout`     | Yes  | Create Stripe checkout session        |
| `POST` | `/api/billing/portal`       | Yes  | Create Stripe customer portal session |
| `POST` | `/api/billing/webhook`      | No   | Stripe webhook (raw body + signature) |

### API keys, Sessions, Admin, Audit, Notifications, Feature Flags

| Method   | Route                            | Auth  | Description                        |
| -------- | -------------------------------- | ----- | ---------------------------------- |
| `POST`   | `/api/api-keys`                  | Yes   | Create API key                     |
| `GET`    | `/api/api-keys`                  | Yes   | List API keys                      |
| `DELETE` | `/api/api-keys/:id`              | Yes   | Revoke API key (soft delete)       |
| `GET`    | `/api/sessions`                  | Yes   | List active sessions               |
| `DELETE` | `/api/sessions/:id`              | Yes   | Revoke a specific session          |
| `DELETE` | `/api/sessions`                  | Yes   | Revoke all sessions                |
| `GET`    | `/api/admin/users`               | ADMIN | List users (paginated, searchable) |
| `PATCH`  | `/api/admin/users/:id`           | ADMIN | Update user (role, ban, suspend)   |
| `DELETE` | `/api/admin/users/:id`           | ADMIN | Delete user                        |
| `GET`    | `/api/audit`                     | Yes   | List audit logs                    |
| `GET`    | `/api/notifications`             | Yes   | List notifications                 |
| `POST`   | `/api/notifications/:id/read`    | Yes   | Mark notification as read          |
| `POST`   | `/api/notifications/read-all`    | Yes   | Mark all as read                   |
| `DELETE` | `/api/notifications/:id`         | Yes   | Delete notification                |
| `GET`    | `/api/notifications/preferences` | Yes   | Get notification preferences       |
| `PATCH`  | `/api/notifications/preferences` | Yes   | Update notification preferences    |
| `GET`    | `/api/feature-flags`             | ADMIN | List feature flags                 |
| `POST`   | `/api/feature-flags`             | ADMIN | Create feature flag                |
| `PATCH`  | `/api/feature-flags/:id`         | ADMIN | Update feature flag                |
| `DELETE` | `/api/feature-flags/:id`         | ADMIN | Delete feature flag                |
| `GET`    | `/health`                        | No    | Liveness check                     |
| `GET`    | `/health/ready`                  | No    | Readiness check (DB ping)          |
| `GET`    | `/api/docs`                      | No    | OpenAPI 3.0 spec (JSON)            |
| `GET`    | `/api/docs/ui`                   | No    | Swagger UI                         |

Protected routes require `Authorization: Bearer <token>`. API key routes accept `X-API-Key: <key>`.

### Session & token behavior

- **Multi-session** — Each login/registration issues an independent refresh token, stored (hashed) in the `refresh_tokens` table. A user can be signed in on multiple devices at once.
- **Refresh rotation** — `POST /api/auth/refresh` revokes the submitted refresh token and returns a new one alongside a new access token.
- **Reuse detection** — If an already-rotated (revoked) refresh token is presented, the entire token family for that user is revoked as a compromise signal.
- **Logout** — `POST /api/auth/logout` with `{ "refreshToken": "..." }` revokes just that session. Without a body, it revokes **all** of the user's refresh tokens (logout everywhere).
- **Access-token invalidation** — Changing or resetting a password increments the user's `tokenVersion`, immediately invalidating all previously issued access tokens (checked in the `authenticate` middleware) and revoking all refresh tokens.
- **Account lockout** — After 5 consecutive failed login attempts an account is locked for 15 minutes (HTTP `423`). The counter resets on a successful login or once the lock expires.

### Two-factor authentication (2FA)

- **Setup** — `POST /api/auth/2fa/setup` generates a TOTP secret and QR code. The secret is encrypted at rest (AES-256-GCM).
- **Enable** — `POST /api/auth/2fa/enable` verifies the first TOTP code and returns 10 single-use backup codes (stored hashed).
- **Login flow** — When 2FA is enabled, `POST /api/auth/login` returns a `challengeToken` instead of tokens. Complete the login with `POST /api/auth/2fa/verify` using a TOTP code or backup code.
- **Attempt limiting** — Each challenge allows a maximum of 5 failed attempts before it's invalidated. The challenge claim is atomic (TOCTOU-safe).
- **Disable** — `POST /api/auth/2fa/disable` requires the account password.

### Middleware guards

- `authenticate` — verifies the JWT and attaches `req.user`.
- `authorize(...roles)` — restricts a route to the given roles (e.g. `authorize('ADMIN')`).
- `requireVerifiedEmail` — blocks access (403) until the user has verified their email. Run it after `authenticate` on business routes: `router.get('/projects', authenticate, requireVerifiedEmail, ctrl.list)`.
- `requireTenant` — resolves the organization from `req.body.orgId` / `req.params.orgId` / `req.query.orgId` and verifies membership.
- `requireOrgRole(...roles)` — restricts to specific org roles (OWNER, ADMIN, MEMBER).

### Running behind a proxy

When deployed behind a reverse proxy or load balancer, set `TRUST_PROXY` (e.g. `TRUST_PROXY=1`) so `req.ip` and rate limiting use the real client IP from `X-Forwarded-For`.

## Health check

```
GET /health
```

Returns `{ status: "ok", timestamp: "..." }`. Use this for uptime monitoring and load balancer health checks.

## API documentation

The API is documented with an OpenAPI 3.0.3 spec auto-generated from the Zod validation schemas used by every route — the spec is always in sync with the actual request validation.

| Endpoint           | Description                                           |
| ------------------ | ----------------------------------------------------- |
| `GET /api/docs`    | OpenAPI 3.0.3 spec as JSON (machine-consumable)       |
| `GET /api/docs/ui` | Interactive Swagger UI (human-consumable, try-it-out) |

The spec covers all 70+ operations across the 12 modules (Auth, Organizations, Admin, Billing, API Keys, Sessions, Audit, Invitations, Notifications, Feature Flags, GDPR, Health) with:

- Path & query parameters derived from each route's Zod `params`/`query` schema
- Request bodies derived from each route's Zod `body` schema
- Response schemas wrapped in the standard `{ success, data }` envelope
- Security schemes for JWT bearer auth (`Authorization: Bearer <token>`) and API key auth (`X-API-Key`)
- Shared error response schema for 4xx/5xx status codes

The server URL in the spec is taken from `APP_URL`. The Swagger UI is disabled in test mode.

## Production deployment

### Environment variables

| Variable                 | Required      | Notes                                                                      |
| ------------------------ | ------------- | -------------------------------------------------------------------------- |
| `NODE_ENV`               | Yes           | Set to `production`.                                                       |
| `PORT`                   | No            | Defaults to `3000`.                                                        |
| `DATABASE_URL`           | Yes           | PostgreSQL connection string.                                              |
| `JWT_SECRET`             | Yes           | **Min 32 chars in production** (enforced at boot).                         |
| `JWT_REFRESH_SECRET`     | Yes           | **Min 32 chars in production** (enforced at boot). Must differ from above. |
| `JWT_EXPIRES_IN`         | No            | Access-token TTL. Defaults to `15m`.                                       |
| `JWT_REFRESH_EXPIRES_IN` | No            | Refresh-token TTL. Defaults to `7d`.                                       |
| `CORS_ORIGIN`            | Yes (prod)    | Frontend origin or comma-separated list. Never `*` in production.          |
| `TRUST_PROXY`            | Behind proxy  | Number of proxy hops (e.g. `1`) so `req.ip`/rate limiting see the real IP. |
| `SECRET_ENCRYPTION_KEY`  | No            | AES-256-GCM key for secrets at rest. Defaults to `JWT_SECRET` if unset.    |
| `RESEND_API_KEY`         | Yes (email)   | Resend API key. If unset, emails are logged & skipped (dev only).          |
| `FROM_EMAIL`             | Yes (email)   | Verified sender address.                                                   |
| `APP_URL`                | Yes           | Public base URL used to build verification / reset links.                  |
| `REDIS_URL`              | Yes (worker)  | Redis connection string for BullMQ + rate limiting.                        |
| `STRIPE_SECRET_KEY`      | Yes (billing) | Stripe API key.                                                            |
| `STRIPE_WEBHOOK_SECRET`  | Yes (billing) | Stripe webhook signing secret.                                             |
| `GOOGLE_CLIENT_ID`       | Yes (OAuth)   | Google OAuth client ID.                                                    |
| `GOOGLE_CLIENT_SECRET`   | Yes (OAuth)   | Google OAuth client secret.                                                |
| `GOOGLE_REDIRECT_URI`    | No            | Google OAuth redirect URI. Defaults to `postmessage`.                      |
| `SENTRY_DSN`             | No            | Sentry DSN for error tracking.                                             |

Generate strong secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

The server validates configuration at boot and **exits** if:

- `DATABASE_URL`, `JWT_SECRET`, or `JWT_REFRESH_SECRET` is missing.
- In production: either JWT secret is shorter than 32 characters, or `CORS_ORIGIN` is unset.

### Pre-flight checklist

- [ ] `NODE_ENV=production`
- [ ] Unique 32+ char `JWT_SECRET` and `JWT_REFRESH_SECRET` (never the `.env.example` defaults)
- [ ] `CORS_ORIGIN` set to your exact frontend origin(s)
- [ ] `TRUST_PROXY` set if behind a load balancer / ingress
- [ ] `SECRET_ENCRYPTION_KEY` set independently from `JWT_SECRET` (recommended)
- [ ] `RESEND_API_KEY`, `FROM_EMAIL`, and `APP_URL` configured for real email delivery
- [ ] `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` configured for billing
- [ ] `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` configured for OAuth
- [ ] Migrations applied against the production database (`prisma migrate deploy`)
- [ ] `/health` wired into your uptime monitor / load balancer probe
- [ ] Secrets injected via your platform's secret manager (not committed to the repo)

### Build & run with Docker

```bash
# Build the production image (multi-stage; installs prod deps only)
docker build -t saas-backend .

# Apply migrations against the production database
npm run db:deploy

# Run the container
docker run -p 3000:3000 --env-file .env saas-backend
```

> Run `npm run db:deploy` (`prisma migrate deploy`), not `db:migrate`, in production — it applies committed migrations without generating new ones or prompting.

### Docker Compose (full stack)

The included `docker-compose.yml` runs PostgreSQL and Redis for local development. For production, extend it with the app and worker services:

```yaml
services:
  api:
    image: ghcr.io/izemhsn/saas-backend-boilerplate:latest
    env_file: .env
    ports:
      - '3000:3000'
    depends_on:
      - postgres
      - redis
  worker:
    image: ghcr.io/izemhsn/saas-backend-boilerplate:latest
    command: ['node', 'src/worker.js']
    env_file: .env
    depends_on:
      - postgres
      - redis
```

## CI/CD

Two GitHub Actions workflows live in `.github/workflows/`:

### CI (`ci.yml`)

Runs on every push to `main`/`dev` and on pull requests. Three jobs:

| Job     | What it does                                                             |
| ------- | ------------------------------------------------------------------------ |
| `lint`  | ESLint + Prettier format check                                           |
| `test`  | Vitest suite with coverage against PostgreSQL + Redis service containers |
| `build` | Docker production image build + smoke test (`/health` responds)          |

`lint` and `test` run in parallel; `build` waits for both to pass. Coverage reports are uploaded as artifacts.

### Deploy (`deploy.yml`)

Runs on push to `main` or version tags (`v*`). Builds the production Docker image and pushes it to **GitHub Container Registry** (GHCR):

```
ghcr.io/<owner>/<repo>:latest        # latest on main
ghcr.io/<owner>/<repo>:sha-<sha>     # immutable per-commit
ghcr.io/<owner>/<repo>:1.2.3         # semver tag
ghcr.io/<owner>/<repo>:1.2           # major.minor
```

The `deploy` job is a placeholder — uncomment and adapt it for your hosting platform (Fly.io, Railway, Render, Kubernetes, VPS, etc.). See the comments in `deploy.yml` for examples.

### Required secrets

The workflows use the built-in `GITHUB_TOKEN` (no extra secrets needed for GHCR). For the deploy step, add platform-specific secrets (e.g. `FLY_API_TOKEN`, `KUBE_CONFIG`) via **Settings → Secrets and variables → Actions**.

## Internationalization (i18n)

All user-facing strings (API error messages, success messages, Zod validation errors, and email templates) are localized via the i18n system in `src/i18n/`.

### Supported locales

- **en** (English) — default/fallback
- **fr** (French)

### How locale is resolved

1. **`X-Lang` header** (e.g. `X-Lang: fr`) — explicit override, highest priority
2. **`Accept-Language` header** — parsed per RFC 4647 (e.g. `fr-FR,fr;q=0.9,en;q=0.8` → `fr`)
3. **Default** — English (`en`) if no supported locale matches

### Adding a new language

1. Create `src/i18n/locales/<code>.json` (copy `en.json` and translate the values)
2. Add the locale code to `SUPPORTED_LOCALES` in `src/i18n/index.js`
3. Add the locale code to `DEFAULT_LOCALE` if you want to change the fallback

### Architecture

- **`src/i18n/index.js`** — `t(key, locale, params)` translate function with `{placeholder}` interpolation, `resolveLocale(acceptLanguage)` parser, `SUPPORTED_LOCALES` + `DEFAULT_LOCALE` exports
- **`src/middleware/i18n.middleware.js`** — attaches `req.lang` (resolved locale) and `req.t(key, params)` (bound translate) to every request
- **`src/utils/httpError.js`** — `httpError(key, statusCode, params)` stores the i18n key + params on the error; the error middleware translates at response time using `req.lang`
- **`src/utils/i18nResponse.js`** — `translateResult(req, data)` helper for controllers to translate service `messageKey` returns into localized `message` fields
- **`src/middleware/validate.middleware.js`** — translates Zod custom messages that are i18n keys (dot-notation strings)
- **`src/modules/shared/email.service.js`** — all email templates accept a `locale` parameter; subjects, headings, body text, and footers are pulled from the locale files

## Testing

Tests are integration tests that hit a real PostgreSQL + Redis instance (no mocks for the database layer).

```bash
# Run the full suite
npm test

# Run a single file
npx vitest run tests/auth.test.js

# Run with coverage
npm run test:cov
```

Each test file cleans up after itself via `afterAll`. Tests use unique email suffixes (`Date.now()`) so parallel runs and repeated executions don't collide.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, code style, and the development workflow.

## Security

For security vulnerabilities, see [SECURITY.md](./SECURITY.md) — **do not open public issues for security reports**.

## License

This project is licensed under the [MIT License](./LICENSE).
