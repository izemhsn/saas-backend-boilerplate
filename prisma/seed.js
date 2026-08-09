import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import bcrypt from 'bcryptjs'
import { createHash } from 'crypto'

const prisma = new PrismaClient({
  adapter: new PrismaPg(new pg.Pool({ connectionString: process.env.DATABASE_URL })),
})

const hashKey = (key) => createHash('sha256').update(key).digest('hex')

async function main() {
  console.log('🌱 Seeding database...\n')

  // ── Plans ──────────────────────────────────────────────────────────
  const freePlan = await prisma.plan.upsert({
    where: { stripePriceId: 'price_free_demo' },
    update: {},
    create: {
      name: 'Free',
      description: 'Perfect for getting started',
      stripePriceId: 'price_free_demo',
      priceCents: 0,
      currency: 'usd',
      interval: 'MONTH',
      features: { projects: 1, members: 3, storage: '100MB' },
      active: true,
    },
  })

  const proPlan = await prisma.plan.upsert({
    where: { stripePriceId: 'price_pro_demo' },
    update: {},
    create: {
      name: 'Pro',
      description: 'For growing teams',
      stripePriceId: 'price_pro_demo',
      priceCents: 2900,
      currency: 'usd',
      interval: 'MONTH',
      features: { projects: 10, members: 10, storage: '10GB', prioritySupport: true },
      active: true,
    },
  })

  const enterprisePlan = await prisma.plan.upsert({
    where: { stripePriceId: 'price_enterprise_demo' },
    update: {},
    create: {
      name: 'Enterprise',
      description: 'For large organizations',
      stripePriceId: 'price_enterprise_demo',
      priceCents: 9900,
      currency: 'usd',
      interval: 'MONTH',
      features: { projects: -1, members: -1, storage: '1TB', prioritySupport: true, sla: true },
      active: true,
    },
  })

  console.log(`  ✓ Plans: ${freePlan.name}, ${proPlan.name}, ${enterprisePlan.name}`)

  // ── Users ──────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('Password123', 12)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@demo.com' },
    update: {},
    create: {
      email: 'admin@demo.com',
      password: passwordHash,
      name: 'Admin User',
      role: 'ADMIN',
      emailVerified: true,
      lastLoginAt: new Date(),
    },
  })

  const owner = await prisma.user.upsert({
    where: { email: 'owner@demo.com' },
    update: {},
    create: {
      email: 'owner@demo.com',
      password: passwordHash,
      name: 'Org Owner',
      role: 'USER',
      emailVerified: true,
      lastLoginAt: new Date(),
    },
  })

  const member1 = await prisma.user.upsert({
    where: { email: 'member@demo.com' },
    update: {},
    create: {
      email: 'member@demo.com',
      password: passwordHash,
      name: 'Team Member',
      role: 'USER',
      emailVerified: true,
      lastLoginAt: new Date(),
    },
  })

  const member2 = await prisma.user.upsert({
    where: { email: 'member2@demo.com' },
    update: {},
    create: {
      email: 'member2@demo.com',
      password: passwordHash,
      name: 'Another Member',
      role: 'USER',
      emailVerified: true,
    },
  })

  const googleUser = await prisma.user.upsert({
    where: { email: 'google@demo.com' },
    update: {},
    create: {
      email: 'google@demo.com',
      name: 'Google User',
      googleId: 'demo-google-123456789',
      role: 'USER',
      emailVerified: true,
      lastLoginAt: new Date(),
    },
  })

  console.log(
    `  ✓ Users: ${admin.name}, ${owner.name}, ${member1.name}, ${member2.name}, ${googleUser.name} (Google OAuth)`,
  )

  // ── Organization ───────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: 'demo-org' },
    update: {},
    create: {
      name: 'Demo Organization',
      slug: 'demo-org',
      ownerId: owner.id,
    },
  })

  // Add members
  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: owner.id } },
    update: {},
    create: { organizationId: org.id, userId: owner.id, role: 'OWNER' },
  })

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: member1.id } },
    update: {},
    create: { organizationId: org.id, userId: member1.id, role: 'ADMIN' },
  })

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: member2.id } },
    update: {},
    create: { organizationId: org.id, userId: member2.id, role: 'MEMBER' },
  })

  console.log(`  ✓ Organization: ${org.name} (owner + 2 members)`)

  // ── Subscriptions ──────────────────────────────────────────────────
  await prisma.subscription.upsert({
    where: { stripeSubscriptionId: 'sub_demo_owner' },
    update: {},
    create: {
      userId: owner.id,
      planId: proPlan.id,
      stripeSubscriptionId: 'sub_demo_owner',
      stripeCustomerId: 'cus_demo_owner',
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  })

  await prisma.subscription.upsert({
    where: { stripeSubscriptionId: 'sub_demo_admin' },
    update: {},
    create: {
      userId: admin.id,
      planId: enterprisePlan.id,
      stripeSubscriptionId: 'sub_demo_admin',
      stripeCustomerId: 'cus_demo_admin',
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  })

  console.log(`  ✓ Subscriptions: owner → Pro, admin → Enterprise`)

  // ── API Keys ───────────────────────────────────────────────────────
  const demoKey = 'sk_demo_key_for_seeding_purposes_only'
  const demoKeyHash = hashKey(demoKey)
  await prisma.apiKey.upsert({
    where: { keyHash: demoKeyHash },
    update: {},
    create: {
      name: 'Demo API Key',
      keyHash: demoKeyHash,
      keyPrefix: demoKey.slice(0, 12),
      userId: owner.id,
      scopes: ['read', 'write'],
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  })

  console.log(`  ✓ API Key: ${demoKey.slice(0, 12)}...${demoKey.slice(-4)}`)

  // ── Audit Logs ─────────────────────────────────────────────────────
  const existingAudits = await prisma.auditLog.count({
    where: { metadata: { path: ['source'], equals: 'seed' } },
  })

  if (existingAudits === 0) {
    const auditActions = [
      { action: 'USER_REGISTER', userId: owner.id, metadata: { source: 'seed' } },
      { action: 'USER_LOGIN', userId: owner.id, metadata: { source: 'seed', ip: '127.0.0.1' } },
      {
        action: 'ORG_CREATED',
        userId: owner.id,
        organizationId: org.id,
        metadata: { source: 'seed', name: org.name },
      },
      {
        action: 'MEMBER_ADDED',
        userId: owner.id,
        organizationId: org.id,
        metadata: { source: 'seed', member: member1.email },
      },
      {
        action: 'SUBSCRIPTION_CREATED',
        userId: owner.id,
        metadata: { source: 'seed', plan: proPlan.name },
      },
    ]

    for (const entry of auditActions) {
      await prisma.auditLog.create({ data: entry })
    }
    console.log(`  ✓ Audit logs: ${auditActions.length} entries`)
  } else {
    console.log(`  ✓ Audit logs: already seeded (${existingAudits} entries)`)
  }

  // ── Pending Invitation ─────────────────────────────────────────────
  const inviteToken = hashKey('demo_invitation_token')
  await prisma.organizationInvitation.upsert({
    where: { token: inviteToken },
    update: {},
    create: {
      organizationId: org.id,
      inviterId: owner.id,
      inviteeEmail: 'newmember@demo.com',
      role: 'MEMBER',
      status: 'PENDING',
      token: inviteToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  console.log(`  ✓ Pending invitation: newmember@demo.com → ${org.name}`)

  // ── Feature Flags ──────────────────────────────────────────────────
  await prisma.featureFlag.upsert({
    where: { key: 'beta_dashboard' },
    update: {},
    create: {
      key: 'beta_dashboard',
      name: 'Beta Dashboard',
      description: 'Enable the new beta dashboard UI',
      type: 'BOOLEAN',
      value: { enabled: false },
      active: true,
    },
  })

  await prisma.featureFlag.upsert({
    where: { key: 'advanced_analytics' },
    update: {},
    create: {
      key: 'advanced_analytics',
      name: 'Advanced Analytics',
      description: 'Plan-gated analytics feature (Pro and Enterprise only)',
      type: 'PLAN',
      value: { plans: ['Pro', 'Enterprise'] },
      active: true,
    },
  })

  await prisma.featureFlag.upsert({
    where: { key: 'new_onboarding_flow' },
    update: {},
    create: {
      key: 'new_onboarding_flow',
      name: 'New Onboarding Flow',
      description: 'Gradual rollout of the new onboarding experience',
      type: 'PERCENTAGE',
      value: { percentage: 50 },
      active: true,
    },
  })

  // Enable beta_dashboard for the demo org via override
  await prisma.organizationFeatureFlag.upsert({
    where: {
      featureFlagId_organizationId: {
        featureFlagId: (await prisma.featureFlag.findUnique({ where: { key: 'beta_dashboard' } }))
          .id,
        organizationId: org.id,
      },
    },
    update: {},
    create: {
      featureFlagId: (await prisma.featureFlag.findUnique({ where: { key: 'beta_dashboard' } })).id,
      organizationId: org.id,
      enabled: true,
      value: { enabled: true },
    },
  })

  console.log(
    `  ✓ Feature flags: beta_dashboard, advanced_analytics, new_onboarding_flow (50% rollout)`,
  )

  console.log('\n✅ Seed complete!\n')
  console.log('  Demo credentials (password for all): Password123')
  console.log('  ┌──────────────────────────────────────────────────────────┐')
  console.log('  │ admin@demo.com   — Admin user (Enterprise plan)         │')
  console.log('  │ owner@demo.com   — Org owner (Pro plan)                 │')
  console.log('  │ member@demo.com  — Org admin member                     │')
  console.log('  │ member2@demo.com — Org member                           │')
  console.log('  │ google@demo.com  — Google OAuth user (no password)      │')
  console.log('  └──────────────────────────────────────────────────────────┘')
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
