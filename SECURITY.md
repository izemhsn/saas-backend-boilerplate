# Security Policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

If you discover a security vulnerability, please report it responsibly:

1. Email **izemhsn@gmail.com** with a description of the issue and steps to reproduce.
2. Include the word `SECURITY` in the subject line.
3. Do not disclose the vulnerability publicly until it has been addressed.

You will receive a response within **48 hours**. If the vulnerability is confirmed, a fix will be prioritized and a security advisory will be published after the patch is released.

## Security measures

This boilerplate implements the following security features:

- **JWT authentication** with access + refresh token rotation and reuse detection
- **Password hashing** via bcrypt (cost factor 12)
- **Rate limiting** with per-route sensitive limiters backed by Redis
- **2FA (TOTP)** with encrypted secret storage (AES-256-GCM), attempt limiting, and backup codes
- **Account lockout** after 5 failed login attempts (15-minute cooldown)
- **Input sanitization** — strips HTML, `javascript:` URIs, `on*` handlers, and prototype pollution keys
- **Helmet** for secure HTTP headers
- **CORS** enforcement (no wildcard in production, boot-time validation)
- **Secret encryption at rest** for sensitive fields (TOTP secrets)
- **GDPR data export** requires password re-authentication
- **Environment validation** at boot (JWT secret length, required vars, production checks)
- **Graceful shutdown** with connection draining
- **Non-root Docker container** (UID 1000)

## Security best practices for deployment

- Generate unique 32+ character JWT secrets (never use the `.env.example` defaults)
- Set `SECRET_ENCRYPTION_KEY` independently from `JWT_SECRET` for key rotation
- Set `CORS_ORIGIN` to your exact frontend origin(s)
- Set `TRUST_PROXY` when behind a reverse proxy
- Inject secrets via your platform's secret manager (never commit `.env`)
- Keep dependencies updated (`npm audit`)
- Enable Sentry for runtime error monitoring
