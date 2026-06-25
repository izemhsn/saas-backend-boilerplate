import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis

// Reuse one connection — avoids too-many-connections in dev
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'error']
      : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}