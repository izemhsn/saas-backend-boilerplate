import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

export const prisma = globalThis.prisma ?? new PrismaClient({
  adapter: new PrismaPg(new pg.Pool({ connectionString: process.env.DATABASE_URL })),
  log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
})

if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma

// import { PrismaClient } from '@prisma/client'
// import { PrismaPg } from '@prisma/adapter-pg'
// import pg from 'pg'

// const globalForPrisma = globalThis

// const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

// // Reuse one connection — avoids too-many-connections in dev
// export const prisma = globalForPrisma.prisma ??
//   new PrismaClient({
//     adapter: new PrismaPg(pool),
//     log: process.env.NODE_ENV === 'development'
//       ? ['query', 'error']
//       : ['error'],
//   })

// if (process.env.NODE_ENV !== 'production') {
//   globalForPrisma.prisma = prisma
// }