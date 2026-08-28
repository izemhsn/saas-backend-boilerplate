// This file touches the DB directly without importing app.js, which is what
// normally loads dotenv as a side effect — load it explicitly so DATABASE_URL
// is populated before config/db.js constructs the pg pool.
import 'dotenv/config'
import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '../src/config/db.js'
import { handleJobFailure } from '../src/modules/jobs/deadLetter.js'

// M8: previously a permanently-failed job (e.g. a verification email that
// exhausts its retries) was only logged, then dropped by BullMQ's
// `removeOnFail` with nothing to alert on or requeue from. These tests pin
// handleJobFailure's two behaviors: no-op on a retry that still has
// attempts left, persist once retries are truly exhausted.
const RUN_ID = Date.now()
const createdIds = []

afterAll(async () => {
  if (createdIds.length) {
    await prisma.failedJob.deleteMany({ where: { id: { in: createdIds } } })
  }
  await prisma.$disconnect()
})

const makeJob = ({
  attemptsMade,
  attempts,
  name = `test-job-${RUN_ID}`,
  data = { foo: 'bar' },
}) => ({
  id: `job-${RUN_ID}-${Math.random()}`,
  name,
  data,
  attemptsMade,
  opts: { attempts },
})

describe('handleJobFailure (M8 dead-letter handling)', () => {
  it('does nothing when the job still has attempts remaining', async () => {
    const job = makeJob({ attemptsMade: 1, attempts: 3 })
    await handleJobFailure('email', job, new Error('transient failure'))

    const row = await prisma.failedJob.findFirst({ where: { jobName: job.name } })
    expect(row).toBeNull()
  })

  it('persists a row once the job has exhausted all attempts', async () => {
    const job = makeJob({ attemptsMade: 3, attempts: 3, data: { to: 'user@example.com' } })
    await handleJobFailure('email', job, new Error('permanent failure'))

    const row = await prisma.failedJob.findFirst({ where: { jobName: job.name } })
    expect(row).not.toBeNull()
    createdIds.push(row.id)
    expect(row.queue).toBe('email')
    expect(row.error).toBe('permanent failure')
    expect(row.attempts).toBe(3)
    expect(row.jobData).toEqual({ to: 'user@example.com' })
  })

  it('treats a missing opts.attempts as a single-attempt job', async () => {
    // opts.attempts is undefined for a job queued with no explicit retry
    // config — attemptsMade (always >= 1 on a failure) should still count
    // as exhausted rather than silently never dead-lettering.
    const job = {
      id: `job-${RUN_ID}-noattempts`,
      name: `no-attempts-${RUN_ID}`,
      data: {},
      attemptsMade: 1,
      opts: {},
    }
    await handleJobFailure('maintenance', job, new Error('boom'))

    const row = await prisma.failedJob.findFirst({ where: { jobName: job.name } })
    expect(row).not.toBeNull()
    createdIds.push(row.id)
  })

  it('does nothing when called with no job', async () => {
    await expect(handleJobFailure('email', null, new Error('n/a'))).resolves.toBeUndefined()
  })
})
