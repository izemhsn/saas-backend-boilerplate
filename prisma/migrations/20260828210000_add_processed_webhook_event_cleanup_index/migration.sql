-- `processed_webhook_events` is insert-only (one row per Stripe event, written
-- by the webhook handler's idempotency check and never read again beyond that
-- insert), so it grew without bound. The maintenance worker now prunes it via
-- cleanupProcessedWebhookEvents, which filters on "createdAt" alone — without
-- this index that daily delete is a full table scan of the largest table in
-- the schema.
CREATE INDEX "processed_webhook_events_createdAt_idx" ON "processed_webhook_events"("createdAt");
