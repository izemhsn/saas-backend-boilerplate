import * as billingService from './billing.service.js'
import { log as auditLog } from '../audit/audit.service.js'
import { translateResult } from '../../utils/i18nResponse.js'

export const listPlans = async (req, res, next) => {
  try {
    const data = await billingService.listPlans(req.validated?.query)
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const getSubscription = async (req, res, next) => {
  try {
    const data = await billingService.getSubscription(req.user.id)
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const createCheckout = async (req, res, next) => {
  try {
    const data = await billingService.createCheckoutSession(req.user.id, req.validated.body)
    auditLog('CHECKOUT_STARTED', {
      userId: req.user.id,
      metadata: { planId: req.validated.body.planId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const createPortal = async (req, res, next) => {
  try {
    const data = await billingService.createPortalSession(req.user.id, req.validated.body)
    auditLog('PORTAL_OPENED', {
      userId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const cancelSubscription = async (req, res, next) => {
  try {
    const data = await billingService.cancelSubscription(req.user.id)
    auditLog('SUBSCRIPTION_CANCELED', {
      userId: req.user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const webhook = async (req, res, next) => {
  try {
    const signature = req.headers['stripe-signature']
    const data = await billingService.handleWebhook(req.body, signature)
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

// ── Org-scoped billing (M12) ── req.tenant is set by requireTenant, same as
// the project module: the org id always comes from the guard, never the raw
// URL param.
export const getOrgSubscription = async (req, res, next) => {
  try {
    const data = await billingService.getOrgSubscription(req.tenant.id)
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const createOrgCheckout = async (req, res, next) => {
  try {
    const data = await billingService.createOrgCheckoutSession(req.tenant.id, req.validated.body)
    auditLog('CHECKOUT_STARTED', {
      userId: req.user.id,
      organizationId: req.tenant.id,
      metadata: { planId: req.validated.body.planId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const createOrgPortal = async (req, res, next) => {
  try {
    const data = await billingService.createOrgPortalSession(req.tenant.id, req.validated.body)
    auditLog('PORTAL_OPENED', {
      userId: req.user.id,
      organizationId: req.tenant.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const cancelOrgSubscription = async (req, res, next) => {
  try {
    const data = await billingService.cancelOrgSubscription(req.tenant.id)
    auditLog('SUBSCRIPTION_CANCELED', {
      userId: req.user.id,
      organizationId: req.tenant.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}
