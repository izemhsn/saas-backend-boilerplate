import * as invitationService from './invitation.service.js'
import { log as auditLog } from '../audit/audit.service.js'
import { queueOrgInvitationEmail } from '../jobs/email.producer.js'

export const createInvitation = async (req, res, next) => {
  try {
    const { invitation, token } = await invitationService.createInvitation(
      req.tenant.id,
      req.user.id,
      req.validated.body,
    )

    auditLog('MEMBER_INVITED', {
      userId: req.user.id,
      organizationId: req.tenant.id,
      metadata: { inviteeEmail: invitation.inviteeEmail, role: invitation.role },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })

    queueOrgInvitationEmail({
      to: invitation.inviteeEmail,
      orgName: req.tenant.name,
      inviterName: req.user.name ?? req.user.email,
      role: invitation.role,
      token,
    })

    res.status(201).json({ success: true, data: { invitation } })
  } catch (err) {
    next(err)
  }
}

export const listInvitations = async (req, res, next) => {
  try {
    const data = await invitationService.listInvitations(req.tenant.id, req.validated?.query)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const cancelInvitation = async (req, res, next) => {
  try {
    const data = await invitationService.cancelInvitation(req.tenant.id, req.validated.params.invitationId)
    auditLog('INVITATION_CANCELED', {
      userId: req.user.id,
      organizationId: req.tenant.id,
      metadata: { invitationId: req.validated.params.invitationId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const listMyInvitations = async (req, res, next) => {
  try {
    const data = await invitationService.listMyInvitations(req.user.id, req.validated?.query)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const acceptInvitation = async (req, res, next) => {
  try {
    const data = await invitationService.acceptInvitation(req.user.id, req.validated.body.token)
    auditLog('INVITATION_ACCEPTED', {
      userId: req.user.id,
      organizationId: data.invitation.organization.id,
      metadata: { role: data.invitation.role },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export const declineInvitation = async (req, res, next) => {
  try {
    const data = await invitationService.declineInvitation(req.user.id, req.validated.body.token)
    auditLog('INVITATION_DECLINED', {
      userId: req.user.id,
      organizationId: data.invitation.organization.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}
