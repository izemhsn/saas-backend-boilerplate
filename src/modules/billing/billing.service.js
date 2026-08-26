import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client.js'
import { prisma } from '../../config/db.js'
import { stripe, isStripeConfigured } from '../../config/stripe.js'
import { httpError } from '../../utils/httpError.js'
import { paginationParams, paginationMeta, parseSort } from '../../utils/query.js'
import { log as auditLog } from '../audit/audit.service.js'
import logger from '../../utils/logger.js'

const planSelect = {
  id: true,
  name: true,
  code: true,
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

// Shared by the personal and org checkout flows: reuses a stored Stripe
// customer id if it still resolves, (re)creates one otherwise, and persists
// a newly created id via the caller-supplied `persist` callback. Pulled out
// because org-scoped billing (M12) needs the identical retrieve-or-create
// dance against Organization.stripeCustomerId instead of User.stripeCustomerId.
const resolveStripeCustomerId = async ({ existingCustomerId, email, name, metadata, persist }) => {
  let customerId = existingCustomerId

  if (customerId) {
    try {
      await stripe.customers.retrieve(customerId)
    } catch (err) {
      // Only treat "resource_missing" (deleted/invalid customer) as a signal to
      // recreate — re-throw network errors, rate limits, and other transient issues
      // so they surface instead of silently creating duplicate customers
      if (err?.code !== 'resource_missing') throw err
      customerId = null
    }
  }

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: email ?? undefined,
      name: name ?? undefined,
      metadata,
    })
    customerId = customer.id
    await persist(customerId)
  }

  return customerId
}

export const createCheckoutSession = async (userId, { planId, successUrl, cancelUrl }) => {
  const plan = await prisma.plan.findUnique({
    where: { id: planId, active: true },
    select: { id: true, stripePriceId: true, name: true },
  })
  if (!plan) throw httpError('errors.planNotFound', 404)

  if (!isStripeConfigured()) {
    throw httpError('errors.stripeNotConfigured', 500)
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, stripeCustomerId: true, name: true },
  })
  if (!user) throw httpError('errors.userNotFound', 404)

  const customerId = await resolveStripeCustomerId({
    existingCustomerId: user.stripeCustomerId,
    email: user.email,
    name: user.name,
    metadata: { userId: user.id },
    persist: (id) => prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: id } }),
  })

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

// ── Org-scoped billing (M12) ──────────────────────────────────────────────
// Mirrors the personal flow above, scoped to an Organization instead of a
// User: the Stripe customer, and the Subscription it eventually produces via
// the webhook, both key on organizationId. Callers are expected to have
// already run requireTenant + requireOrgRole('OWNER', 'ADMIN') — these
// functions trust the organizationId they're given.

export const getOrgSubscription = async (organizationId) => {
  const subscription = await prisma.subscription.findFirst({
    where: { organizationId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } },
    select: subscriptionSelect,
    orderBy: { createdAt: 'desc' },
  })

  return { subscription: subscription ?? null }
}

export const createOrgCheckoutSession = async (
  organizationId,
  { planId, successUrl, cancelUrl },
) => {
  const plan = await prisma.plan.findUnique({
    where: { id: planId, active: true },
    select: { id: true, stripePriceId: true, name: true },
  })
  if (!plan) throw httpError('errors.planNotFound', 404)

  if (!isStripeConfigured()) {
    throw httpError('errors.stripeNotConfigured', 500)
  }

  const org = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: {
      id: true,
      name: true,
      stripeCustomerId: true,
      owner: { select: { email: true } },
    },
  })
  if (!org) throw httpError('errors.organizationNotFound', 404)

  const customerId = await resolveStripeCustomerId({
    existingCustomerId: org.stripeCustomerId,
    email: org.owner.email,
    name: org.name,
    metadata: { organizationId: org.id },
    persist: (id) =>
      prisma.organization.update({ where: { id: organizationId }, data: { stripeCustomerId: id } }),
  })

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { organizationId: org.id, planId: plan.id },
    subscription_data: {
      metadata: { organizationId: org.id, planId: plan.id },
    },
  })

  return { url: session.url, sessionId: session.id }
}

export const createOrgPortalSession = async (organizationId, { returnUrl }) => {
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { stripeCustomerId: true },
  })
  if (!org) throw httpError('errors.organizationNotFound', 404)
  if (!org.stripeCustomerId) {
    throw httpError('errors.noBillingAccount', 400)
  }

  if (!isStripeConfigured()) {
    throw httpError('errors.stripeNotConfigured', 500)
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: org.stripeCustomerId,
    return_url: returnUrl,
  })

  return { url: session.url }
}

export const cancelOrgSubscription = async (organizationId) => {
  const subscription = await prisma.subscription.findFirst({
    where: { organizationId, status: { in: ['ACTIVE', 'TRIALING'] } },
    orderBy: { createdAt: 'desc' },
  })
  if (!subscription) throw httpError('errors.noActiveSubscription', 404)

  if (!isStripeConfigured()) {
    throw httpError('errors.stripeNotConfigured', 500)
  }

  await stripe.subscriptions.cancel(subscription.stripeSubscriptionId)

  const updated = await prisma.subscription.update({
    where: { id: subscription.id },
    data: { status: 'CANCELED', canceledAt: new Date() },
    select: subscriptionSelect,
  })

  return { subscription: updated }
}

export const createPortalSession = async (userId, { returnUrl }) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  })
  if (!user) throw httpError('errors.userNotFound', 404)
  if (!user.stripeCustomerId) {
    throw httpError('errors.noBillingAccount', 400)
  }

  if (!isStripeConfigured()) {
    throw httpError('errors.stripeNotConfigured', 500)
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
  if (!subscription) throw httpError('errors.noActiveSubscription', 404)

  if (!isStripeConfigured()) {
    throw httpError('errors.stripeNotConfigured', 500)
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
    throw httpError('errors.missingStripeSignature', 400)
  }

  if (!isStripeConfigured()) {
    throw httpError('errors.stripeNotConfiguredShort', 500)
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    throw httpError('errors.stripeWebhookSecretNotConfigured', 500)
  }

  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    throw httpError('errors.webhookSignatureFailed', 400, { message: err.message })
  }

  // Idempotency — Stripe's delivery guarantee is at-least-once, so the same
  // event can arrive more than once (a retry after a slow 200, or a manual
  // resend from the dashboard). Insert the event id first and skip
  // processing entirely on a P2002: this makes reprocessing a no-op instead
  // of a second (possibly conflicting) write.
  try {
    await prisma.processedWebhookEvent.create({
      data: { id: event.id, type: event.type },
    })
  } catch (err) {
    if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.info({ eventId: event.id, type: event.type }, 'Duplicate Stripe webhook event skipped')
      return { received: true, type: event.type }
    }
    throw err
  }

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object, event.id, event.created)
      break
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object, event.id, event.created)
      break
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object)
      break
    default:
      logger.info({ eventId: event.id, type: event.type }, 'Unhandled Stripe webhook event type')
      break
  }

  return { received: true, type: event.type }
}

const handleCheckoutCompleted = async (session, eventId, eventCreated) => {
  // Exactly one of userId/organizationId is present — createCheckoutSession
  // and createOrgCheckoutSession each set only their own (M12).
  const { userId, organizationId, planId } = session.metadata ?? {}
  if ((!userId && !organizationId) || !planId) {
    logger.warn(
      { eventId, sessionId: session.id },
      'checkout.session.completed missing owner/planId metadata — skipped',
    )
    return
  }

  const stripeSubscriptionId = session.subscription
  if (!stripeSubscriptionId) {
    logger.warn(
      { eventId, userId, organizationId, sessionId: session.id },
      'checkout.session.completed has no subscription id — skipped',
    )
    return
  }

  const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId)
  await upsertSubscription({ userId, organizationId }, planId, stripeSub, eventCreated)
}

const handleSubscriptionUpdated = async (stripeSub, eventId, eventCreated) => {
  const { userId, organizationId, planId } = stripeSub.metadata ?? {}
  if ((!userId && !organizationId) || !planId) {
    logger.warn(
      { eventId, stripeSubscriptionId: stripeSub.id },
      'Subscription event missing owner/planId metadata — skipped',
    )
    return
  }

  await upsertSubscription({ userId, organizationId }, planId, stripeSub, eventCreated)
}

const handleSubscriptionDeleted = async (stripeSub) => {
  // Read the owner first (needed for the audit log) — updateMany alone
  // doesn't return the rows it touched.
  const existing = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: stripeSub.id },
    select: { userId: true, organizationId: true },
  })

  const result = await prisma.subscription.updateMany({
    where: { stripeSubscriptionId: stripeSub.id },
    data: { status: 'CANCELED', canceledAt: new Date() },
  })

  if (result.count > 0 && existing) {
    auditLog('SUBSCRIPTION_CANCELED', {
      userId: existing.userId,
      organizationId: existing.organizationId,
      metadata: { stripeSubscriptionId: stripeSub.id, source: 'webhook' },
    })
  }
}

// `owner` is `{ userId }` or `{ organizationId }` — never both, matching the
// Subscription.userId/organizationId exclusivity the DB enforces (M12).
const upsertSubscription = async (owner, planId, stripeSub, eventCreated) => {
  const plan = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true } })
  if (!plan) {
    logger.warn(
      { stripeSubscriptionId: stripeSub.id, planId },
      'Webhook references an unknown planId — skipped',
    )
    return
  }

  // Stripe moved current_period_start/end to subscription items in newer API versions.
  // Fall back to the first item if the top-level fields are absent.
  const item = stripeSub.items?.data?.[0]
  const periodStart = stripeSub.current_period_start ?? item?.current_period_start
  const periodEnd = stripeSub.current_period_end ?? item?.current_period_end

  // Falls back to "now" for events that (unusually) carry no `created`
  // timestamp, so the ordering guard below still has something to compare.
  const stripeEventCreatedAt = eventCreated ? new Date(eventCreated * 1000) : new Date()

  const data = {
    userId: owner.userId ?? null,
    organizationId: owner.organizationId ?? null,
    planId,
    stripeSubscriptionId: stripeSub.id,
    stripeCustomerId: stripeSub.customer,
    status: mapStripeStatus(stripeSub.status),
    trialEndsAt: stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
    currentPeriodStart: periodStart ? new Date(periodStart * 1000) : null,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    canceledAt: stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null,
    stripeEventCreatedAt,
  }

  // Ordering guard — Stripe delivery is unordered, so a delayed event must
  // not overwrite state already written by a newer one (e.g. a late
  // `updated` resurrecting ACTIVE over a subsequent `deleted`/CANCELED).
  // Only write when no row exists yet for this subscription, or the
  // existing row was last written by an older (or equally-timed) event.
  const updateResult = await prisma.subscription.updateMany({
    where: {
      stripeSubscriptionId: stripeSub.id,
      OR: [{ stripeEventCreatedAt: null }, { stripeEventCreatedAt: { lte: stripeEventCreatedAt } }],
    },
    data,
  })

  if (updateResult.count > 0) {
    auditLog('SUBSCRIPTION_UPDATED', {
      userId: owner.userId,
      organizationId: owner.organizationId,
      metadata: { stripeSubscriptionId: stripeSub.id, status: data.status },
    })
    return
  }

  // updateMany matched nothing: either the row doesn't exist yet (create),
  // or it exists but this event is stale relative to it (skip).
  try {
    await prisma.subscription.create({ data })
    auditLog('SUBSCRIPTION_CREATED', {
      userId: owner.userId,
      organizationId: owner.organizationId,
      metadata: { stripeSubscriptionId: stripeSub.id, status: data.status },
    })
  } catch (err) {
    // P2002 on stripeSubscriptionId means a concurrent webhook created the
    // row between the updateMany above and this create — or the row exists
    // and this event was simply stale. Either way there's nothing more to
    // do: a newer event already owns (or will own) this row.
    if (err instanceof PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.info(
        { stripeSubscriptionId: stripeSub.id, stripeEventCreatedAt },
        'Stale or racing Stripe webhook event skipped',
      )
      return
    }
    throw err
  }
}
