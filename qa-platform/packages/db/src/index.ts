/**
 * Shared Prisma client. Single instance reused across the API process.
 * Run `npm run db:generate` once after install to emit the client.
 */
import { PrismaClient } from '@prisma/client';
import { workspaceDbUrl } from '@qa/shared/paths';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Local-first default: with no explicit DATABASE_URL, point at the per-user
// runtime workspace SQLite file (<workspace>/qa.db) — never a repo/absolute path.
const url = process.env.DATABASE_URL?.trim() || workspaceDbUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url } },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export * from '@prisma/client';
