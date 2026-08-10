import { getEmailQueue } from './queues.js'
import logger from '../../utils/logger.js'
import { DEFAULT_LOCALE } from '../../i18n/index.js'

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

export const queueVerificationEmail = ({ to, token, name, locale = DEFAULT_LOCALE }) =>
  enqueueEmail('sendVerificationEmail', { to, token, name, locale })

export const queuePasswordResetEmail = ({ to, token, name, locale = DEFAULT_LOCALE }) =>
  enqueueEmail('sendPasswordResetEmail', { to, token, name, locale })

export const queueOrgInvitationEmail = ({
  to,
  orgName,
  inviterName,
  role,
  token,
  locale = DEFAULT_LOCALE,
}) => enqueueEmail('sendOrgInvitationEmail', { to, orgName, inviterName, role, token, locale })
