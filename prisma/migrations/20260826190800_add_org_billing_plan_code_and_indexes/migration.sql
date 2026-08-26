-- M11: stable, immutable plan identifier for access-control gating.
-- Added nullable first because existing `plans` rows predate this column —
-- backfilled with `id` (guaranteed unique) since `name` has duplicates in
-- practice, then locked to NOT NULL + UNIQUE. Only newly created plans are
-- expected to set a human-meaningful code going forward.
ALTER TABLE "plans" ADD COLUMN "code" TEXT;
UPDATE "plans" SET "code" = "id" WHERE "code" IS NULL;
ALTER TABLE "plans" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- M12: org-level (B2B) billing. `userId` becomes optional so a subscription
-- can instead scope to an organization; a CHECK constraint (Prisma's schema
-- language can't express cross-column exclusivity) guarantees every row
-- still has exactly one owner. Existing rows are unaffected: they all have
-- `userId` set and `organizationId` NULL, satisfying the constraint as-is.
ALTER TABLE "organizations" ADD COLUMN "stripeCustomerId" TEXT;

ALTER TABLE "subscriptions" ADD COLUMN "organizationId" TEXT,
  ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_owner_xor_check"
  CHECK (num_nonnulls("userId", "organizationId") = 1);

CREATE INDEX "subscriptions_organizationId_idx" ON "subscriptions"("organizationId");

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- M13: missing indexes surfaced by the audit.
CREATE INDEX "organizations_ownerId_idx" ON "organizations"("ownerId");
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- The composite below covers createInvitation's pending-duplicate check and
-- listInvitations (both filtered on organizationId); its leftmost prefix
-- also serves plain organizationId lookups, making the old standalone
-- [organizationId] and [status] indexes redundant — dropped in favor of it.
-- [inviteeEmail] alone is kept: listMyInvitations filters on inviteeEmail
-- with no organizationId in its where-clause, so it can't use the composite.
DROP INDEX "organization_invitations_organizationId_idx";
DROP INDEX "organization_invitations_status_idx";
CREATE INDEX "organization_invitations_organizationId_inviteeEmail_status_idx" ON "organization_invitations"("organizationId", "inviteeEmail", "status");
