import * as billingService from './billing.service.js'

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
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const createPortal = async (req, res, next) => {
  try {
    const data = await billingService.createPortalSession(req.user.id, req.validated.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const cancelSubscription = async (req, res, next) => {
  try {
    const data = await billingService.cancelSubscription(req.user.id)
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
