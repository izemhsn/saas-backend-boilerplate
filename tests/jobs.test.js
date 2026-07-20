import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getEmailQueue } from '../src/modules/jobs/queues.js'
import { queueVerificationEmail, queuePasswordResetEmail } from '../src/modules/jobs/email.producer.js'
import { sendVerificationEmail, sendPasswordResetEmail } from '../src/modules/shared/email.service.js'

vi.mock('../src/config/redis.js', () => ({
  getRedisConnection: () => ({
    on: vi.fn(),
    quit: vi.fn(),
  }),
}))

vi.mock('../src/modules/shared/email.service.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue({ id: 'test' }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ id: 'test' }),
}))

describe('Email producer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('queueVerificationEmail returns skipped in test mode', async () => {
    const result = await queueVerificationEmail({
      to: 'test@example.com',
      token: 'abc123',
      name: 'Test',
    })

    expect(result.id).toBe('skipped')
  })

  it('queuePasswordResetEmail returns skipped in test mode', async () => {
    const result = await queuePasswordResetEmail({
      to: 'test@example.com',
      token: 'abc123',
      name: 'Test',
    })

    expect(result.id).toBe('skipped')
  })
})

describe('Email queue configuration', () => {
  it('creates a queue with correct name', () => {
    const queue = getEmailQueue()
    expect(queue.name).toBe('email')
  })

  it('returns the same queue instance (singleton)', () => {
    const q1 = getEmailQueue()
    const q2 = getEmailQueue()
    expect(q1).toBe(q2)
  })
})

describe('Email worker processor', () => {
  it('sendVerificationEmail is called with correct data', async () => {
    const data = { to: 'test@example.com', token: 'abc123', name: 'Test' }
    await sendVerificationEmail(data)
    expect(sendVerificationEmail).toHaveBeenCalledWith(data)
  })

  it('sendPasswordResetEmail is called with correct data', async () => {
    const data = { to: 'test@example.com', token: 'abc123', name: 'Test' }
    await sendPasswordResetEmail(data)
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(data)
  })
})
