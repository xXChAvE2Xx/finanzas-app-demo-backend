import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import { calcNextDate } from '@/lib/payroll-dates'
import type { JwtPayload } from '@/lib/auth/jwt'

const schema = z.object({
  accountId:         z.string().cuid(),
  amount:            z.number().positive(),
  description:       z.string().min(1).max(200),
  periodicity:       z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'ANNUAL']),
  dayOfMonth:        z.number().int().min(1).max(31).optional(),
  adjustForWeekends: z.boolean().optional(),
  sourceType:        z.enum(['PAYROLL', 'FREELANCE', 'RENTAL', 'BUSINESS', 'OTHER']).optional(),
  startDate:         z.string().datetime(),
  endDate:           z.string().datetime().optional(),
})

export const GET = withAuth(async (_req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const incomes = await prisma.recurringIncome.findMany({
    where:   { userId: user.sub, isActive: true },
    orderBy: { nextDate: 'asc' },
    include: { account: { select: { id: true, name: true, color: true, type: true } } },
  })
  return NextResponse.json(incomes)
})

export const POST = withAuth(async (req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten().fieldErrors }, { status: 422 })
  }

  const account = await prisma.account.findFirst({ where: { id: parsed.data.accountId, userId: user.sub } })
  if (!account) return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 404 })

  const start      = new Date(parsed.data.startDate)
  const adjust     = parsed.data.adjustForWeekends ?? false
  const nextDate   = calcNextDate(start, parsed.data.periodicity, parsed.data.dayOfMonth, adjust)

  const income = await prisma.recurringIncome.create({
    data: {
      userId:            user.sub,
      accountId:         parsed.data.accountId,
      amount:            parsed.data.amount,
      description:       parsed.data.description,
      periodicity:       parsed.data.periodicity,
      dayOfMonth:        parsed.data.dayOfMonth,
      adjustForWeekends: adjust,
      sourceType:        parsed.data.sourceType ?? 'OTHER',
      startDate:         start,
      endDate:           parsed.data.endDate ? new Date(parsed.data.endDate) : undefined,
      nextDate,
      isActive:          true,
    },
    include: { account: { select: { id: true, name: true, color: true, type: true } } },
  })
  return NextResponse.json(income, { status: 201 })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
