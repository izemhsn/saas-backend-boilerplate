-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'API_KEY_RESTORED';
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'SESSIONS_REVOKED_ALL';

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");
