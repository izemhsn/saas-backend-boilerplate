-- AlterTable: make password optional (OAuth-only users have no password)
ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;

-- AlterTable: add googleId column for Google OAuth linking
ALTER TABLE "users" ADD COLUMN "googleId" TEXT;

-- CreateIndex: unique constraint on googleId
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- AlterTable: add USER_OAUTH_LOGIN to AuditAction enum
ALTER TYPE "AuditAction" ADD VALUE 'USER_OAUTH_LOGIN';
