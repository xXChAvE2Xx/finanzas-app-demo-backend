import { PrismaClient, CategoryType } from '@prisma/client'
import * as bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const SYSTEM_CATEGORIES: Array<{ name: string; type: CategoryType; color: string; icon: string; group: string }> = [
  // ── INGRESOS ─────────────────────────────────────────────
  { name: 'Salario / Nómina',     type: 'INCOME',  color: '#10b981', icon: 'briefcase',    group: 'Ingresos fijos' },
  { name: 'Freelance',            type: 'INCOME',  color: '#06b6d4', icon: 'laptop',       group: 'Ingresos variables' },
  { name: 'Inversiones',          type: 'INCOME',  color: '#8b5cf6', icon: 'trending-up',  group: 'Ingresos variables' },
  { name: 'Venta de artículos',   type: 'INCOME',  color: '#f59e0b', icon: 'tag',          group: 'Ingresos variables' },
  { name: 'Regalo / Transferencia', type: 'INCOME', color: '#ec4899', icon: 'gift',        group: 'Otros ingresos' },
  { name: 'Bono / Extra',         type: 'INCOME',  color: '#14b8a6', icon: 'star',         group: 'Ingresos variables' },
  { name: 'Otros ingresos',       type: 'INCOME',  color: '#6b7280', icon: 'plus-circle',  group: 'Otros ingresos' },

  // ── GASTOS ───────────────────────────────────────────────
  { name: 'Alimentación',         type: 'EXPENSE', color: '#ef4444', icon: 'shopping-cart', group: 'Alimentación' },
  { name: 'Restaurantes',         type: 'EXPENSE', color: '#f97316', icon: 'utensils',      group: 'Alimentación' },
  { name: 'Transporte',           type: 'EXPENSE', color: '#3b82f6', icon: 'car',           group: 'Transporte' },
  { name: 'Gasolina',             type: 'EXPENSE', color: '#64748b', icon: 'fuel',          group: 'Transporte' },
  { name: 'Renta / Hipoteca',     type: 'EXPENSE', color: '#dc2626', icon: 'home',          group: 'Hogar' },
  { name: 'Servicios (luz/agua)', type: 'EXPENSE', color: '#eab308', icon: 'zap',           group: 'Hogar' },
  { name: 'Internet / Teléfono',  type: 'EXPENSE', color: '#6366f1', icon: 'wifi',          group: 'Hogar' },
  { name: 'Salud / Médico',       type: 'EXPENSE', color: '#10b981', icon: 'heart',         group: 'Salud' },
  { name: 'Farmacia',             type: 'EXPENSE', color: '#059669', icon: 'pill',          group: 'Salud' },
  { name: 'Entretenimiento',      type: 'EXPENSE', color: '#a855f7', icon: 'tv',            group: 'Ocio' },
  { name: 'Streaming',            type: 'EXPENSE', color: '#7c3aed', icon: 'play-circle',   group: 'Ocio' },
  { name: 'Ropa y accesorios',    type: 'EXPENSE', color: '#ec4899', icon: 'shirt',         group: 'Compras' },
  { name: 'Educación',            type: 'EXPENSE', color: '#0ea5e9', icon: 'book-open',     group: 'Educación' },
  { name: 'Gym / Deporte',        type: 'EXPENSE', color: '#22c55e', icon: 'dumbbell',      group: 'Salud' },
  { name: 'Mascotas',             type: 'EXPENSE', color: '#f59e0b', icon: 'paw-print',     group: 'Mascotas' },
  { name: 'Viajes',               type: 'EXPENSE', color: '#06b6d4', icon: 'plane',         group: 'Ocio' },
  { name: 'Seguros',              type: 'EXPENSE', color: '#78716c', icon: 'shield',        group: 'Finanzas' },
  { name: 'Ahorro / Inversión',   type: 'EXPENSE', color: '#8b5cf6', icon: 'piggy-bank',    group: 'Finanzas' },
  { name: 'Deuda / Crédito',      type: 'EXPENSE', color: '#dc2626', icon: 'credit-card',   group: 'Finanzas' },
  { name: 'Regalos',              type: 'EXPENSE', color: '#f472b6', icon: 'gift',          group: 'Compras' },
  { name: 'Suscripciones',        type: 'EXPENSE', color: '#64748b', icon: 'repeat',        group: 'Ocio' },
  { name: 'Mantenimiento hogar',  type: 'EXPENSE', color: '#92400e', icon: 'tool',          group: 'Hogar' },
  { name: 'Otros gastos',         type: 'EXPENSE', color: '#6b7280', icon: 'more-horizontal', group: 'Otros' },
]

async function main() {
  console.log('🌱 Starting database seed...')

  // ── 1. Categorías del sistema ─────────────────────────────
  // Prisma no admite upsert con null en un unique compuesto; usamos findFirst + create/update.
  console.log('📂 Seeding system categories...')
  for (const cat of SYSTEM_CATEGORIES) {
    const existing = await prisma.category.findFirst({
      where: { name: cat.name, type: cat.type, isSystem: true },
    })
    if (existing) {
      await prisma.category.update({
        where: { id: existing.id },
        data: { color: cat.color, icon: cat.icon, group: cat.group },
      })
    } else {
      await prisma.category.create({
        data: {
          name: cat.name,
          type: cat.type,
          color: cat.color,
          icon: cat.icon,
          group: cat.group,
          isSystem: true,
          userId: null,
        },
      })
    }
  }
  console.log(`✅ ${SYSTEM_CATEGORIES.length} system categories seeded`)

  // ── 2. Usuario demo ───────────────────────────────────────
  console.log('👤 Seeding demo user...')
  const passwordHash = await bcrypt.hash('demo1234', 12)

  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@finanzas.app' },
    update: {},
    create: {
      email: 'demo@finanzas.app',
      name: 'Usuario Demo',
      passwordHash,
      encryptionSalt: 'demo-salt-change-in-prod',
    },
  })

  // ── 3. Suscripción FREE para demo ─────────────────────────
  await prisma.subscription.upsert({
    where: { userId: demoUser.id },
    update: {},
    create: {
      userId: demoUser.id,
      plan: 'FREE',
      status: 'ACTIVE',
    },
  })

  // ── 4. Cuentas demo ───────────────────────────────────────
  console.log('🏦 Seeding demo accounts...')
  const [tdcBanamex, tddSantander, efectivo] = await Promise.all([
    prisma.account.upsert({
      where: { id: 'demo-account-tdc-1' },
      update: {},
      create: {
        id: 'demo-account-tdc-1',
        userId: demoUser.id,
        name: 'Banamex Oro',
        type: 'CREDIT',
        bank: 'Citibanamex',
        lastFourDigits: 'NjU0Mw==', // "6543" base64 (mock cifrado)
        color: '#dc2626',
        icon: 'credit-card',
        creditLimit: 30000,
        currentBalance: 8500,
        cutDay: 12,
        paymentDueDay: 7,
        minimumPayment: 400,
        interestRate: 0.36,
      },
    }),
    prisma.account.upsert({
      where: { id: 'demo-account-tdd-1' },
      update: {},
      create: {
        id: 'demo-account-tdd-1',
        userId: demoUser.id,
        name: 'Santander Débito',
        type: 'DEBIT',
        bank: 'Santander',
        lastFourDigits: 'MTIzNA==', // "1234" base64
        color: '#dc0000',
        icon: 'credit-card',
        currentBalance: 15200,
      },
    }),
    prisma.account.upsert({
      where: { id: 'demo-account-cash-1' },
      update: {},
      create: {
        id: 'demo-account-cash-1',
        userId: demoUser.id,
        name: 'Efectivo',
        type: 'CASH',
        color: '#10b981',
        icon: 'banknote',
        currentBalance: 2500,
      },
    }),
  ])

  // ── 5. Ingreso recurrente demo (nómina quincenal) ─────────
  console.log('💰 Seeding demo recurring income...')
  await prisma.recurringIncome.upsert({
    where: { id: 'demo-income-1' },
    update: {},
    create: {
      id: 'demo-income-1',
      userId: demoUser.id,
      accountId: tddSantander.id,
      amount: 12500,
      description: 'Nómina quincenal',
      periodicity: 'BIWEEKLY',
      dayOfMonth: 15,
      startDate: new Date('2024-01-01'),
      nextDate: new Date(new Date().getFullYear(), new Date().getMonth(), 15),
      isActive: true,
    },
  })

  // ── 6. MSI demo ───────────────────────────────────────────
  console.log('🛍️ Seeding demo MSI credit...')
  const now = new Date()
  const msiStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const msiEnd = new Date(now.getFullYear(), now.getMonth() + 11, 1)
  await prisma.mSICredit.upsert({
    where: { id: 'demo-msi-1' },
    update: {},
    create: {
      id: 'demo-msi-1',
      userId: demoUser.id,
      accountId: tdcBanamex.id,
      description: 'iPhone 16 Pro',
      vendor: 'Apple Store',
      totalAmount: 24000,
      months: 12,
      monthlyAmount: 2000,
      interestRate: null, // MSI puro
      startDate: msiStart,
      endDate: msiEnd,
      paidMonths: 1,
      status: 'ACTIVE',
    },
  })

  console.log('✅ Demo user seeded:', demoUser.email)
  console.log('🎉 Seed completed successfully!')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
