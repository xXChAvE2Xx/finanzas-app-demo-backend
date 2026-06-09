import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import { encryptLastFour } from '@/lib/crypto/encrypt'
import type { JwtPayload } from '@/lib/auth/jwt'

const createSchema = z.object({
  name:           z.string().min(1).max(100),
  type:           z.enum(['CHECKING', 'SAVINGS', 'DEBIT', 'CREDIT', 'CASH', 'INVESTMENT']),
  bank:           z.string().max(100).optional(),
  lastFourDigits: z.string().regex(/^\d{4}$/).optional(),
  color:          z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
  icon:           z.string().optional(),
  notes:          z.string().max(500).optional(),
  // TDC fields
  creditLimit:    z.number().positive().optional(),
  currentBalance: z.number().optional(),
  // deuda_corte_inicial — declared statement balance for the current cycle
  cutDebt:        z.number().min(0).optional(),
  cutDay:         z.number().int().min(1).max(31).optional(),
  paymentDueDay:  z.number().int().min(1).max(31).optional(),
  minimumPayment: z.number().positive().optional(),
  interestRate:   z.number().min(0).max(5).optional(),
})

export const GET = withAuth(async (_req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const accounts = await prisma.account.findMany({
    where: { userId: user.sub, isActive: true },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { transactions: true } },
      msiCredits: {
        where: { status: 'ACTIVE' },
        select: { id: true, monthlyAmount: true, description: true },
      },
    },
  })

  return NextResponse.json(
    accounts.map(a => ({
      ...a,
      lastFourDigits: undefined, // never expose encrypted value to client
      activeInstallments: a.msiCredits.length,
      totalMonthlyMSI: a.msiCredits.reduce((s, m) => s + Number(m.monthlyAmount), 0),
    }))
  )
})

export const POST = withAuth(async (req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten().fieldErrors }, { status: 422 })
  }

  const data = parsed.data
  const encryptedDigits = data.lastFourDigits ? encryptLastFour(data.lastFourDigits) : undefined

  // For a credit card we no longer ask for the TOTAL debt. The user declares
  // the "deuda al corte" (cutDebt); the running balance starts equal to it and
  // grows only with post-cut regular purchases. MSI debt is tracked separately.
  const isCredit = data.type === 'CREDIT'
  const cutDebt = isCredit ? (data.cutDebt ?? 0) : null
  const currentBalance = isCredit ? (data.cutDebt ?? 0) : (data.currentBalance ?? 0)

  const account = await prisma.account.create({
    data: {
      userId: user.sub,
      name: data.name,
      type: data.type,
      bank: data.bank,
      lastFourDigits: encryptedDigits,
      color: data.color,
      icon: data.icon,
      notes: data.notes,
      creditLimit: data.creditLimit,
      currentBalance,
      cutDebt,
      cutDay: data.cutDay,
      paymentDueDay: data.paymentDueDay,
      minimumPayment: data.minimumPayment,
      interestRate: data.interestRate,
    },
  })

  return NextResponse.json({ ...account, lastFourDigits: undefined }, { status: 201 })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
