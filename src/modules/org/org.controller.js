import * as orgService from './org.service.js'

export const createOrganization = async (req, res, next) => {
  try {
    const data = await orgService.createOrganization(req.user.id, req.validated.body)
    res.status(201).json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const listOrganizations = async (req, res, next) => {
  try {
    const data = await orgService.listOrganizations(req.user.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const getOrganization = async (req, res, next) => {
  try {
    const data = await orgService.getOrganization(req.tenant.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const updateOrganization = async (req, res, next) => {
  try {
    const data = await orgService.updateOrganization(req.tenant.id, req.validated.body)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const deleteOrganization = async (req, res, next) => {
  try {
    const data = await orgService.deleteOrganization(req.tenant.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const listMembers = async (req, res, next) => {
  try {
    const data = await orgService.listMembers(req.tenant.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const updateMemberRole = async (req, res, next) => {
  try {
    const data = await orgService.updateMemberRole(
      req.tenant.id,
      req.validated.params.userId,
      req.validated.body.role,
    )
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const removeMember = async (req, res, next) => {
  try {
    const data = await orgService.removeMember(req.tenant.id, req.validated.params.userId)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}
