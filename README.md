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

| Command | Description |
|---|---|
| `npm run dev` | Start server with hot-reload (nodemon) |
| `npm start` | Start server |
| `npm test` | Run test suite |
| `npm run test:cov` | Run tests with coverage report |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:studio` | Open Prisma Studio |

## Auth endpoints

| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | No | Register — returns JWT + email verification token |
| `POST` | `/api/auth/login` | No | Login — returns JWT |
| `POST` | `/api/auth/refresh` | No | Re-sign JWT from a valid token |
| `POST` | `/api/auth/verify-email` | No | Verify email with token from registration |
| `POST` | `/api/auth/change-password` | Yes | Change password (requires current password) |
| `POST` | `/api/auth/change-email` | Yes | Change email (requires password, returns new JWT) |
| `POST` | `/api/auth/logout` | Yes | Logout (stateless — invalidate client-side) |
| `GET` | `/api/auth/me` | Yes | Get current user profile |

Protected routes require `Authorization: Bearer <token>`.

## Health check

```
GET /health
```

Returns `{ status: "ok", timestamp: "..." }`. Use this for uptime monitoring and load balancer health checks.
