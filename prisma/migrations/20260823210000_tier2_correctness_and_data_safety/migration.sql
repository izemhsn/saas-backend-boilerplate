-- H8: allow a soft-deleted user's email/googleId/pendingEmail to be reused.
-- Previously these were unique across ALL rows including soft-deleted ones,
-- so a deleted account's email became permanently unusable — the only escape
-- was an admin restore. Replace the full-table unique indexes with ones
-- scoped to live rows (WHERE "deletedAt" IS NULL). No dedupe step is needed:
-- the prior full-table constraint already guaranteed zero existing
-- duplicates, deleted or not.
--
-- NOTE: raw SQL because Prisma's schema language cannot express partial
-- (filtered) unique indexes — see
-- 20260818152809_add_pending_invitation_partial_unique_index for the same
-- technique already used in this repo.
DROP INDEX "users_email_key";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email") WHERE "deletedAt" IS NULL;

DROP INDEX "users_googleId_key";
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId") WHERE "deletedAt" IS NULL;

DROP INDEX "users_pendingEmail_key";
CREATE UNIQUE INDEX "users_pendingEmail_key" ON "users"("pendingEmail") WHERE "deletedAt" IS NULL;

-- H5: Stripe webhook idempotency (dedupe by event.id — Stripe delivery is
-- at-least-once) and an ordering guard column (skip a write from an event
-- older than whichever last wrote a given subscription — Stripe delivery is
-- also unordered).
-- CreateTable
CREATE TABLE "processed_webhook_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhook_events_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN "stripeEventCreatedAt" TIMESTAMP(3);

-- H6/H7: new audit action for the ownership-transfer endpoint that unblocks
-- GDPR account deletion for an owner whose org still has other members.
-- AlterEnum
-- This migration adds one value to an enum, so it is safe to combine with
-- the other statements above in a single migration (adding more than one
-- enum value per migration is unsafe on PostgreSQL 11 and earlier).
ALTER TYPE "AuditAction" ADD VALUE 'ORG_OWNERSHIP_TRANSFERRED';
