# saas-backend-boilerplate

Express-based SaaS backend starter with environment configuration and a health check endpoint.

## Prerequisites

- [Node.js](https://nodejs.org/) 24.16.0 (see `.nvmrc`)

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

Start the development server:

```bash
npm run dev
```

The server runs at `http://localhost:3000` by default, or the port set in `.env`.
