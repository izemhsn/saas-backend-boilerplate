# saas-backend-boilerplate

Production-ready Express + Prisma SaaS backend starter. Includes JWT authentication, role-based access, request validation, rate limiting, and a full test suite.

## Stack

- **Runtime** — Node.js 24 (ESM)
- **Framework** — Express 5
- **Database** — PostgreSQL via Prisma ORM
- **Auth** — JWT (`jsonwebtoken`), bcrypt (`bcryptjs`)
- **Validation** — Zod
- **Testing** — Vitest + Supertest

## Prerequisites

- [Node.js](https://nodejs.org/) 24.16.0 (see `.nvmrc`)
- [Docker](https://www.docker.com/) (for the local PostgreSQL instance)

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

Start the database:

```bash
docker compose up -d
```

Run migrations and generate the Prisma client:

```bash
npm run db:migrate
npm run db:generate
```

Start the development server:

```bash
npm run dev
```

The server runs at `http://localhost:3000` by default, or the port set in `.env`.

## Scripts

| Command                | Description                            |
| ---------------------- | -------------------------------------- |
| `npm run dev`          | Start server with hot-reload (nodemon) |
| `npm start`            | Start server                           |
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

## Auth endpoints

| Method | Route                           | Auth | Description                                                    |
| ------ | ------------------------------- | ---- | -------------------------------------------------------------- |
| `POST` | `/api/auth/register`            | No   | Register — returns JWT + email verification token              |
| `POST` | `/api/auth/login`               | No   | Login — returns JWT                                            |
| `POST` | `/api/auth/refresh`             | No   | Exchange a refresh token for a new JWT + rotated refresh token |
| `POST` | `/api/auth/verify-email`        | No   | Verify email with token from registration                      |
| `POST` | `/api/auth/resend-verification` | No   | Issue a new email verification token                           |
| `POST` | `/api/auth/forgot-password`     | No   | Issue a password reset token (1h expiry)                       |
| `POST` | `/api/auth/reset-password`      | No   | Reset password using a valid reset token                       |
| `POST` | `/api/auth/change-password`     | Yes  | Change password (requires current password)                    |
| `POST` | `/api/auth/change-email`        | Yes  | Change email (requires password, verified before switching)    |
| `POST` | `/api/auth/logout`              | Yes  | Logout — see session behavior below                            |
| `GET`  | `/api/auth/me`                  | Yes  | Get current user profile                                       |

Protected routes require `Authorization: Bearer <token>`.

### Session & token behavior

- **Multi-session** — Each login/registration issues an independent refresh token, stored (hashed) in the `refresh_tokens` table. A user can be signed in on multiple devices at once.
- **Refresh rotation** — `POST /api/auth/refresh` revokes the submitted refresh token and returns a new one alongside a new access token.
- **Reuse detection** — If an already-rotated (revoked) refresh token is presented, the entire token family for that user is revoked as a compromise signal.
- **Logout** — `POST /api/auth/logout` with `{ "refreshToken": "..." }` revokes just that session. Without a body, it revokes **all** of the user's refresh tokens (logout everywhere).
- **Access-token invalidation** — Changing or resetting a password increments the user's `tokenVersion`, immediately invalidating all previously issued access tokens (checked in the `authenticate` middleware) and revoking all refresh tokens.
- **Account lockout** — After 5 consecutive failed login attempts an account is locked for 15 minutes (HTTP `423`). The counter resets on a successful login or once the lock expires.

### Middleware guards

- `authenticate` — verifies the JWT and attaches `req.user`.
- `authorize(...roles)` — restricts a route to the given roles (e.g. `authorize('ADMIN')`).
- `requireVerifiedEmail` — blocks access (403) until the user has verified their email. Run it after `authenticate` on business routes: `router.get('/projects', authenticate, requireVerifiedEmail, ctrl.list)`.

### Running behind a proxy

When deployed behind a reverse proxy or load balancer, set `TRUST_PROXY` (e.g. `TRUST_PROXY=1`) so `req.ip` and rate limiting use the real client IP from `X-Forwarded-For`.

## Health check

```
GET /health
```

Returns `{ status: "ok", timestamp: "..." }`. Use this for uptime monitoring and load balancer health checks.

## Production deployment

### Environment variables

| Variable                 | Required     | Notes                                                                      |
| ------------------------ | ------------ | -------------------------------------------------------------------------- |
| `NODE_ENV`               | Yes          | Set to `production`.                                                       |
| `PORT`                   | No           | Defaults to `3000`.                                                        |
| `DATABASE_URL`           | Yes          | PostgreSQL connection string.                                              |
| `JWT_SECRET`             | Yes          | **Min 32 chars in production** (enforced at boot).                         |
| `JWT_REFRESH_SECRET`     | Yes          | **Min 32 chars in production** (enforced at boot). Must differ from above. |
| `JWT_EXPIRES_IN`         | No           | Access-token TTL. Defaults to `15m`.                                       |
| `JWT_REFRESH_EXPIRES_IN` | No           | Refresh-token TTL. Defaults to `7d`.                                       |
| `CORS_ORIGIN`            | Yes (prod)   | Exact frontend origin. Never `*` in production (enforced at boot).         |
| `TRUST_PROXY`            | Behind proxy | Number of proxy hops (e.g. `1`) so `req.ip`/rate limiting see the real IP. |
| `RESEND_API_KEY`         | Yes (email)  | Resend API key. If unset, emails are logged & skipped (dev only).          |
| `FROM_EMAIL`             | Yes (email)  | Verified sender address.                                                   |
| `APP_URL`                | Yes          | Public base URL used to build verification / reset links.                  |

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
- [ ] `CORS_ORIGIN` set to your exact frontend origin
- [ ] `TRUST_PROXY` set if behind a load balancer / ingress
- [ ] `RESEND_API_KEY`, `FROM_EMAIL`, and `APP_URL` configured for real email delivery
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
