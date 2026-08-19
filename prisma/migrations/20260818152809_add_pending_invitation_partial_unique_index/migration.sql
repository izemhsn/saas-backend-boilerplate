-- Prevent duplicate PENDING invitations for the same organization + email.
-- The application pre-checks before creating, but two concurrent requests can
-- both pass the check (check-then-create race). This partial unique index makes
-- the database the source of truth; the service maps the resulting P2002 to a
-- 409 "pendingInvitationExists" response.
--
-- NOTE: this is a raw SQL migration because Prisma's schema language cannot
-- express partial (filtered) unique indexes. Prisma's schema engine ignores
-- indexes with WHERE predicates, so this does not cause migration drift.

-- Dedupe first: existing rows may already contain duplicate PENDING
-- invitations (the race this index closes). Keep the most recent one per
-- (organizationId, inviteeEmail) and cancel the rest.
UPDATE "organization_invitations"
SET "status" = 'CANCELED', "canceledAt" = now(), "updatedAt" = now()
WHERE "status" = 'PENDING'
  AND "id" NOT IN (
    SELECT DISTINCT ON ("organizationId", "inviteeEmail") "id"
    FROM "organization_invitations"
    WHERE "status" = 'PENDING'
    ORDER BY "organizationId", "inviteeEmail", "createdAt" DESC
  );

CREATE UNIQUE INDEX "organization_invitations_org_email_pending_key"
ON "organization_invitations" ("organizationId", "inviteeEmail")
WHERE "status" = 'PENDING';