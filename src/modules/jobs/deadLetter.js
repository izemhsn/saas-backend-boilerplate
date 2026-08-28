import { prisma } from '../../config/db.js'
import { getSentry } from '../../config/sentry.js'
import logger from '../../utils/logger.js'

// M8: BullMQ's `failed` event fires on *every* failed attempt, not just the
// last one — a job with `attempts: 3` fires it up to 3 times before BullMQ
// gives up. Call this from a worker's `failed` handler; it no-ops on a
// retry that still has attempts left, and only dead-letters (persists,
// logs a countable event, alerts Sentry) once the job has truly exhausted
// its retries and `removeOnFail` is about to drop it for good.
export const handleJobFailure = async (queueName, job, err) => {
  if (!job) return

  const attemptsMade = job.attemptsMade ?? 0
  const maxAttempts = job.opts?.attempts ?? 1
  const exhausted = attemptsMade >= maxAttempts
  if (!exhausted) return

  // A stable event name (not just a free-text message) so a log aggregator
  // can count/alert on it — this codebase has no metrics library, so a
  // structured, greppable log line is the "metric" per the fix note.
  logger.error(
    {
      event: 'job_dead_lettered',
      queue: queueName,
      jobId: job.id,
      jobName: job.name,
      attempts: attemptsMade,
      err: err.message,
    },
    'Job permanently failed after exhausting retries — moved to dead letter',
  )

  const sentry = getSentry()
  if (sentry) sentry.captureException(err)

  try {
    await prisma.failedJob.create({
      data: {
        queue: queueName,
        jobName: job.name,
        jobData: job.data ?? {},
        error: err.message,
        attempts: attemptsMade,
      },
    })
  } catch (persistErr) {
    // Never let dead-letter bookkeeping crash the worker — the job is
    // already lost from the queue at this point regardless.
    logger.error({ err: persistErr }, 'Failed to persist dead-lettered job')
  }
}
