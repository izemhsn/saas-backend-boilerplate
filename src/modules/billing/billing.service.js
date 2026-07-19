import { prisma } from '../../config/db.js'
import { stripe, isStripeConfigured } from '../../config/stripe.js'
import { httpError } from '../../utils/httpError.js'
import { paginationParams, paginationMeta, parseSort } from '../../utils/query.js'

const planSelect = {
  id: true,
  name: true,
  description: true,
  stripePriceId: true,
  priceCents: true,
  currency: true,
  interval: true,
  features: true,
  active: true,
  createdAt: true,
}

const subscriptionSelect = {
  id: true,
  status: true,
  trialEndsAt: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  canceledAt: true,
  createdAt: true,
  updatedAt: true,
  plan: { select: planSelect },
}

const mapStripeStatus = (stripeStatus) => {
  const map = {
    active: 'ACTIVE',
    trialing: 'TRIALING',
    past_due: 'PAST_DUE',
    canceled: 'CANCELED',
    incomplete: 'INCOMPLETE',
    incomplete_expired: 'INCOMPLETE_EXPIRED',
    unpaid: 'UNPAID',
  }
  return map[stripeStatus] ?? 'INCOMPLETE'
}

export const listPlans = async (query = {}) => {
  const { page, limit, sort, order, interval } = query

  const where = { active: true }
  if (interval) where.interval = interval

  const [plans, total] = await Promise.all([
    prisma.plan.findMany({
      where,
      select: planSelect,
      orderBy: parseSort(sort, order, ['createdAt', 'name', 'priceCents']),
      ...paginationParams(page, limit),
    }),
    prisma.plan.count({ where }),
  ])

  return {
    plans,
    pagination: paginationMeta(page, limit, total),
  }
}

export const getSubscription = async (userId) => {
  const subscription = await prisma.subscription.findFirst({
    where: { userId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
    select: subscriptionSelect,
    orderBy: { createdAt: 'desc' },
  })

  return { subscription: subscription ?? null }
}

export const createCheckoutSession = async (userId, { planId, successUrl, cancelUrl }) => {
  const plan = await prisma.plan.findUnique({
    where: { id: planId, active: true },
    select: { id: true, stripePriceId: true, name: true },
  })
  if (!plan) throw httpError('Plan not found', 404)

  if (!isStripeConfigured()) {
    throw httpError('Stripe is not configured — set STRIPE_SECRET_KEY', 500)
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, stripeCustomerId: true, name: true },
  })
  if (!user) throw httpError('User not found', 404)

  let customerId = user.stripeCustomerId

  if (customerId) {
    try {
      await stripe.customers.retrieve(customerId)
    } catch {
      customerId = null
    }
  }

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name ?? undefined,
      metadata: { userId: user.id },
    })
    customerId = customer.id
    await prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customerId },
    })
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId: user.id, planId: plan.id },
    subscription_data: {
      metadata: { userId: user.id, planId: plan.id },
    },
  })

  return { url: session.url, sessionId: session.id }
}

export const createPortalSession = async (userId, { returnUrl }) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  })
  if (!user) throw httpError('User not found', 404)
  if (!user.stripeCustomerId) {
    throw httpError('No billing account found — subscribe to a plan first', 400)
  }

  if (!isStripeConfigured()) {
    throw httpError('Stripe is not configured — set STRIPE_SECRET_KEY', 500)
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: returnUrl,
  })

  return { url: session.url }
}

export const cancelSubscription = async (userId) => {
  const subscription = await prisma.subscription.findFirst({
    where: { userId, status: { in: ['ACTIVE', 'TRIALING'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (!subscription) throw httpError('No active subscription found', 404)

  if (!isStripeConfigured()) {
    throw httpError('Stripe is not configured — set STRIPE_SECRET_KEY', 500)
  }

  await stripe.subscriptions.cancel(subscription.stripeSubscriptionId)

  const updated = await prisma.subscription.update({
    where: { id: subscription.id },
    data: { status: 'CANCELED', canceledAt: new Date() },
    select: subscriptionSelect,
  })

  return { subscription: updated }
}

export const handleWebhook = async (rawBody, signature) => {
  if (!signature) {
    throw httpError('Missing Stripe signature header', 400)
  }

  if (!isStripeConfigured()) {
    throw httpError('Stripe is not configured', 500)
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    throw httpError('STRIPE_WEBHOOK_SECRET is not configured', 500)
  }

  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    throw httpError(`Webhook signature verification failed: ${err.message}`, 400)
  }

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object)
      break
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object)
      break
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object)
      break
    default:
      break
  }

  return { received: true, type: event.type }
}

const handleCheckoutCompleted = async (session) => {
  const { userId, planId } = session.metadata ?? {}
  if (!userId || !planId) return

  const stripeSubscriptionId = session.subscription
  if (!stripeSubscriptionId) return

  const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId)
  await upsertSubscription(userId, planId, stripeSub)
}

const handleSubscriptionUpdated = async (stripeSub) => {
  const { userId, planId } = stripeSub.metadata ?? {}
  if (!userId || !planId) return

  await upsertSubscription(userId, planId, stripeSub)
}

const handleSubscriptionDeleted = async (stripeSub) => {
  await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: stripeSub.id },
    data: { status: 'CANCELED', canceledAt: new Date() },
  })
}

const upsertSubscription = async (userId, planId, stripeSub) => {
  const plan = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true } })
  if (!plan) return

  const data = {
    userId,
    planId,
    stripeSubscriptionId: stripeSub.id,
    stripeCustomerId: stripeSub.customer,
    status: mapStripeStatus(stripeSub.status),
    trialEndsAt: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
    currentPeriodStart: stripeSub.current_period_start
      ? new Date(stripeSub.current_period_start * 1000)
      : null,
    currentPeriodEnd: stripeSub.current_period_end
      ? new Date(stripeSub.current_period_end * 1000)
      : null,
    canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null,
  }

  await prisma.subscription.upsert({
    where: { stripeSubscriptionId: stripeSub.id },
    create: data,
    update: data,
  })
}
