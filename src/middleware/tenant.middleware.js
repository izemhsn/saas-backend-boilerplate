import { prisma } from '../config/db.js'

// Resolves the organization from the URL param `:orgId`, verifies that the
// authenticated user is a member, and attaches { id, role } to req.tenant.
// Must run after `authenticate`.
// Usage: router.get('/orgs/:orgId/projects', authenticate, requireTenant, ctrl.list)
export const requireTenant = async (req, res, next) => {
  const orgId = req.params.orgId
  if (!orgId) {
    return res.status(400).json({ success: false, message: 'Organization ID is required' })
  }

  try {
    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: orgId, userId: req.user.id },
      },
      select: {
        role: true,
        organization: {
          select: { id: true, name: true, slug: true, ownerId: true },
        },
      },
    })

    if (!membership) {
      return res.status(403).json({ success: false, message: 'You do not have access to this organization' })
    }

    req.tenant = {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      ownerId: membership.organization.ownerId,
      role: membership.role,
    }
    next()
  } catch (err) {
    next(err)
  }
}

// Checks that the authenticated user has one of the allowed roles within the
// current tenant. Must run after `requireTenant`.
// Usage: router.delete('/orgs/:orgId', authenticate, requireTenant, requireOrgRole('OWNER'), ctrl.remove)
export const requireOrgRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.tenant) {
      return res.status(400).json({ success: false, message: 'No tenant context' })
    }
    if (!roles.includes(req.tenant.role)) {
      return res.status(403).json({ success: false, message: 'Insufficient organization permissions' })
    }
    next()
  }
