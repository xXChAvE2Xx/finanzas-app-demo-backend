import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import { buildAmortizationTable, calcPaymentToAvoidInterest } from '@/lib/msi/amortization'
import type { JwtPayload } from '@/lib/auth/jwt'

const updateSchema = z.object({
  status:     z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']).optional(),
  paidMonths: z.number().int().min(0).optional(),
})

export const GET = withAuth(async (_req: NextRequest, ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const { id } = await ctx.params
  const credit = await prisma.mSICredit.findFirst({
    where: { id, userId: user.sub },
    include: { account: true },
  })
  if (!credit) return NextResponse.json({ error: 'MSI no encontrado' }, { status: 404 })

  const amortization = buildAmortizationTable(
    Number(credit.totalAmount),
    credit.months,
    credit.interestRate ? Number(credit.interestRate) : null,
    credit.startDate
  )

  // "Pago para no generar intereses" para esta TDC en el periodo actual
  const now = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), credit.account.cutDay ?? 1)
  if (periodStart > now) periodStart.setMonth(periodStart.getMonth() - 1)
  const periodEnd = new Date(periodStart)
  periodEnd.setMonth(periodEnd.getMonth() + 1)

  const currentExpenses = await prisma.transaction.aggregate({
    where: {
      userId: user.sub, accountId: credit.accountId,
      type: 'EXPENSE',
      date: { gte: periodStart, lt: periodEnd },
    },
    _sum: { amount: true },
  })

  const activeMsi = await prisma.mSICredit.findMany({
    where: { accountId: credit.accountId, status: 'ACTIVE' },
  })

  const paymentToAvoidInterest = calcPaymentToAvoidInterest(
    Number(currentExpenses._sum.amount ?? 0),
    activeMsi
  )

  return NextResponse.json({
    ...credit,
    amortization,
    paymentToAvoidInterest,
    currentPeriodExpenses: Number(currentExpenses._sum.amount ?? 0),
  })
})

export const PATCH = withAuth(async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const { id } = await ctx.params
  const credit = await prisma.mSICredit.findFirst({ where: { id, userId: user.sub } })
  if (!credit) return NextResponse.json({ error: 'MSI no encontrado' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten().fieldErrors }, { status: 422 })
  }

  const updated = await prisma.mSICredit.update({ where: { id }, data: parsed.data })
  return NextResponse.json(updated)
})

export const DELETE = withAuth(async (_req: NextRequest, ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const { id } = await ctx.params
  const credit = await prisma.mSICredit.findFirst({ where: { id, userId: user.sub } })
  if (!credit) return NextResponse.json({ error: 'MSI no encontrado' }, { status: 404 })

  await prisma.mSICredit.update({ where: { id }, data: { status: 'CANCELLED' } })
  return NextResponse.json({ message: 'MSI cancelado' })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
