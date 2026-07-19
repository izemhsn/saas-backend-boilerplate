import * as billingService from './billing.service.js'
import { log as auditLog } from '../audit/audit.service.js'

export const listPlans = async (req, res, next) => {
  try {
    const data = await billingService.listPlans(req.validated?.query)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const getSubscription = async (req, res, next) => {
  try {
    const data = await billingService.getSubscription(req.user.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const createCheckout = async (req, res, next) => {
  try {
    const data = await billingService.createCheckoutSession(req.user.id, req.validated.body)
    auditLog('CHECKOUT_STARTED', { userId: req.user.id, metadata: { planId: req.validated.body.planId }, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const createPortal = async (req, res, next) => {
  try {
    const data = await billingService.createPortalSession(req.user.id, req.validated.body)
    auditLog('PORTAL_OPENED', { userId: req.user.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const cancelSubscription = async (req, res, next) => {
  try {
    const data = await billingService.cancelSubscription(req.user.id)
    auditLog('SUBSCRIPTION_CANCELED', { userId: req.user.id, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const webhook = async (req, res, next) => {
  try {
    const signature = req.headers['stripe-signature']
    const data = await billingService.handleWebhook(req.body, signature)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}
