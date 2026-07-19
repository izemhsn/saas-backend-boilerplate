import * as apiKeyService from './apikey.service.js'

export const createApiKey = async (req, res, next) => {
  try {
    const data = await apiKeyService.createApiKey(req.user.id, req.validated.body)
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
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const deleteApiKey = async (req, res, next) => {
  try {
    const data = await apiKeyService.deleteApiKey(req.user.id, req.validated.params.keyId)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}
