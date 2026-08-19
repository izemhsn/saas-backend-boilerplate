import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

// Connection pool — tunable via env so deployments can size it to their
// Postgres max_connections / instance count without code changes.
//   DATABASE_POOL_MAX                    max connections per process (default 10, pg default)
//   DATABASE_POOL_IDLE_TIMEOUT_MS        close idle connections after this (default 30s)
//   DATABASE_POOL_CONNECTION_TIMEOUT_MS  fail fast if no connection can be acquired
//                                        (default 10s — pg's default of 0 waits forever,
//                                        which hangs requests when the DB is unreachable)
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: Number(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS ?? 30_000),
  connectionTimeoutMillis: Number(process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ?? 10_000),
})

export const prisma =
  globalThis.prisma ??
  new PrismaClient({
    adapter: new PrismaPg(pool),
    log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma
