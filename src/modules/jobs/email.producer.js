import { getEmailQueue } from './queues.js'
import logger from '../../utils/logger.js'

const isTest = process.env.NODE_ENV === 'test'
const isQueueDisabled = process.env.JOB_QUEUE_DISABLED === 'true'

const enqueueEmail = async (jobName, data) => {
  if (isTest || isQueueDisabled) {
    logger.debug({ jobName }, 'Email queue disabled — skipping enqueue')
    return { id: 'skipped' }
  }

  const queue = getEmailQueue()
  const job = await queue.add(jobName, data)
  logger.info({ jobId: job.id, jobName }, 'Email job enqueued')
  return { id: job.id }
}

export const queueVerificationEmail = ({ to, token, name }) =>
  enqueueEmail('sendVerificationEmail', { to, token, name })

export const queuePasswordResetEmail = ({ to, token, name }) =>
  enqueueEmail('sendPasswordResetEmail', { to, token, name })

export const queueOrgInvitationEmail = ({ to, orgName, inviterName, role, token }) =>
  enqueueEmail('sendOrgInvitationEmail', { to, orgName, inviterName, role, token })
