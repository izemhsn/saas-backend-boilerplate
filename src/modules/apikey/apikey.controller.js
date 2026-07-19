import * as apiKeyService from './apikey.service.js'
import { log as auditLog } from '../audit/audit.service.js'

export const createApiKey = async (req, res, next) => {
  try {
    const data = await apiKeyService.createApiKey(req.user.id, req.validated.body)
    auditLog('API_KEY_CREATED', { userId: req.user.id, metadata: { name: req.validated.body.name }, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const listApiKeys = async (req, res, next) => {
  try {
    const data = await apiKeyService.listApiKeys(req.user.id, req.validated?.query)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const getApiKey = async (req, res, next) => {
  try {
    const data = await apiKeyService.getApiKey(req.user.id, req.validated.params.keyId)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const revokeApiKey = async (req, res, next) => {
  try {
    const data = await apiKeyService.revokeApiKey(req.user.id, req.validated.params.keyId)
    auditLog('API_KEY_REVOKED', { userId: req.user.id, metadata: { keyId: req.validated.params.keyId }, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const deleteApiKey = async (req, res, next) => {
  try {
    const data = await apiKeyService.deleteApiKey(req.user.id, req.validated.params.keyId)
    auditLog('API_KEY_DELETED', { userId: req.user.id, metadata: { keyId: req.validated.params.keyId }, ipAddress: req.ip, userAgent: req.headers['user-agent'] })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}
