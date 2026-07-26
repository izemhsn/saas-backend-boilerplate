-- CreateEnum
CREATE TYPE "FeatureFlagType" AS ENUM ('BOOLEAN', 'PERCENTAGE', 'PLAN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'FEATURE_FLAG_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'FEATURE_FLAG_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'FEATURE_FLAG_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'FEATURE_FLAG_OVERRIDE_SET';
ALTER TYPE "AuditAction" ADD VALUE 'FEATURE_FLAG_OVERRIDE_REMOVED';

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "FeatureFlagType" NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_feature_flags" (
    "id" TEXT NOT NULL,
    "featureFlagId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "value" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- CreateIndex
CREATE INDEX "organization_feature_flags_organizationId_idx" ON "organization_feature_flags"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_feature_flags_featureFlagId_organizationId_key" ON "organization_feature_flags"("featureFlagId", "organizationId");

-- AddForeignKey
ALTER TABLE "organization_feature_flags" ADD CONSTRAINT "organization_feature_flags_featureFlagId_fkey" FOREIGN KEY ("featureFlagId") REFERENCES "feature_flags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_feature_flags" ADD CONSTRAINT "organization_feature_flags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
