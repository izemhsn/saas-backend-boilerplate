import * as projectService from './project.service.js'
import { log as auditLog } from '../audit/audit.service.js'
import { translateResult } from '../../utils/i18nResponse.js'

// req.tenant is set by requireTenant — the org id always comes from the guard,
// never from the raw URL param, so an authorization check and the query that
// follows it can never disagree about which tenant is in play.
export const listProjects = async (req, res, next) => {
  try {
    const data = await projectService.listProjects(req.tenant.id, req.validated.query)
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const getProject = async (req, res, next) => {
  try {
    const data = await projectService.getProject(req.tenant.id, req.validated.params.projectId)
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const createProject = async (req, res, next) => {
  try {
    const data = await projectService.createProject(req.tenant.id, req.user.id, req.validated.body)
    auditLog('PROJECT_CREATED', {
      userId: req.user.id,
      organizationId: req.tenant.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { projectId: data.project.id, name: data.project.name },
    })
    res.status(201).json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const updateProject = async (req, res, next) => {
  try {
    const { projectId } = req.validated.params
    const data = await projectService.updateProject(req.tenant.id, projectId, req.validated.body)
    auditLog('PROJECT_UPDATED', {
      userId: req.user.id,
      organizationId: req.tenant.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { projectId, fields: Object.keys(req.validated.body) },
    })
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const deleteProject = async (req, res, next) => {
  try {
    const { projectId } = req.validated.params
    const data = await projectService.deleteProject(req.tenant.id, projectId)
    auditLog('PROJECT_DELETED', {
      userId: req.user.id,
      organizationId: req.tenant.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { projectId },
    })
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const exportProjects = async (req, res, next) => {
  try {
    const data = await projectService.exportProjects(req.tenant.id)
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}

export const projectAnalytics = async (req, res, next) => {
  try {
    const data = await projectService.getProjectAnalytics(req.tenant.id)
    res.json({ success: true, data: translateResult(req, data) })
  } catch (err) {
    next(err)
  }
}
