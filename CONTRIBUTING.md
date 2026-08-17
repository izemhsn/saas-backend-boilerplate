# Contributing

Thank you for your interest in contributing! This guide covers everything you need to get started.

## Prerequisites

- [Node.js](https://nodejs.org/) 24.16.0 (see `.nvmrc`)
- [Docker](https://www.docker.com/) (for local PostgreSQL + Redis)
- [npm](https://www.npmjs.com/) (ships with Node.js)

## Setup

```bash
git clone https://github.com/izemhsn/saas-backend-boilerplate.git
cd saas-backend-boilerplate
npm install
cp .env.example .env
docker compose up -d
npm run db:migrate
npm run db:generate
npm run db:seed   # optional — seeds plans, demo users, and sample data
npm run dev
```

## Development workflow

1. Create a branch from `dev`:

   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feat/your-feature
   ```

2. Make your changes. Follow the existing code style — ESLint and Prettier are enforced in CI.

3. Run checks before pushing:

   ```bash
   npm run lint
   npm run format:check
   npm test
   ```

4. Commit using [conventional commits](https://www.conventionalcommits.org/):

   ```
   feat: add webhook retry logic
   fix: correct rate limiter prefix collision
   docs: update API endpoint table
   refactor: extract token validation into middleware
   test: add integration tests for 2FA backup codes
   chore: bump dependencies
   ```

5. Push and open a pull request against `dev`. Fill in the PR template.

## Code style

- **ESM** — all files use `import`/`export` (no CommonJS).
- **No semicolons** — enforced by Prettier.
- **Single quotes** — enforced by Prettier.
- **Trailing commas** — enforced by Prettier.
- **Max 100 chars** per line — enforced by Prettier.
- **No unused variables** — enforced by ESLint (`argsIgnorePattern: ^_`).

Run `npm run lint:fix` and `npm run format` to auto-fix.

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
```

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

## Database migrations

```bash
# Create a new migration from schema changes
npm run db:migrate -- --name add_new_table

# Apply migrations in production
npm run db:deploy
```

Never edit an existing migration — always create a new one. Prisma migrations are committed to the repo.

## Adding a new module

1. Create `src/modules/<name>/` with:
   - `<name>.router.js` — route definitions with middleware chain
   - `<name>.controller.js` — request/response handling, calls service
   - `<name>.service.js` — business logic, calls Prisma
   - `<name>.schema.js` — Zod validation schemas (imported by router + docs spec)
2. Register the router in `src/app.js`.
3. Add i18n keys to `src/i18n/locales/en.json` and `fr.json`.
4. Write tests in `tests/<name>.test.js`.
5. Add the module's endpoints to the README API table.

## Reporting bugs

Open a [GitHub Issue](https://github.com/izemhsn/saas-backend-boilerplate/issues) using the Bug Report template. Include:

- Node.js version
- OS
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs (redact secrets)

## Security vulnerabilities

**Do not open a public issue for security vulnerabilities.** See [SECURITY.md](./SECURITY.md) for responsible disclosure.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
