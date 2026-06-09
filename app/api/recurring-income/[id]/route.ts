import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import { calcNextDate } from '@/lib/payroll-dates'
import type { JwtPayload } from '@/lib/auth/jwt'

const updateSchema = z.object({
  amount:            z.number().positive().optional(),
  description:       z.string().min(1).max(200).optional(),
  periodicity:       z.enum(['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'ANNUAL']).optional(),
  dayOfMonth:        z.number().int().min(1).max(31).nullable().optional(),
  adjustForWeekends: z.boolean().optional(),
  sourceType:        z.enum(['PAYROLL', 'FREELANCE', 'RENTAL', 'BUSINESS', 'OTHER']).optional(),
  accountId:         z.string().cuid().optional(),
  startDate:         z.string().datetime().optional(),
  endDate:           z.string().datetime().nullable().optional(),
  isActive:          z.boolean().optional(),
})

export const PATCH = withAuth(async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const { id } = await ctx.params
  const record = await prisma.recurringIncome.findFirst({ where: { id, userId: user.sub } })
  if (!record) return NextResponse.json({ error: 'Ingreso no encontrado' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten().fieldErrors }, { status: 422 })
  }

  const { startDate, periodicity, dayOfMonth, adjustForWeekends, ...rest } = parsed.data

  // Recalculate nextDate if any scheduling field changed
  const needsRecalc = startDate || periodicity || dayOfMonth !== undefined || adjustForWeekends !== undefined
  const effectivePeriodicity  = periodicity       ?? record.periodicity
  const effectiveStart        = startDate ? new Date(startDate) : record.startDate
  const effectiveDayOfMonth   = dayOfMonth !== undefined ? dayOfMonth : record.dayOfMonth
  const effectiveAdjust       = adjustForWeekends !== undefined ? adjustForWeekends : record.adjustForWeekends
  const nextDate = needsRecalc
    ? calcNextDate(effectiveStart, effectivePeriodicity, effectiveDayOfMonth, effectiveAdjust)
    : undefined

  const updated = await prisma.recurringIncome.update({
    where: { id },
    data: {
      ...rest,
      ...(periodicity       !== undefined && { periodicity }),
      ...(adjustForWeekends !== undefined && { adjustForWeekends }),
      ...(startDate         !== undefined && { startDate: new Date(startDate) }),
      ...(dayOfMonth        !== undefined && { dayOfMonth }),
      ...(rest.endDate      !== undefined && { endDate: rest.endDate ? new Date(rest.endDate) : null }),
      ...(nextDate          !== undefined && { nextDate }),
    },
    include: { account: { select: { id: true, name: true, color: true, type: true } } },
  })
  return NextResponse.json(updated)
})

export const DELETE = withAuth(async (_req: NextRequest, ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const { id } = await ctx.params
  const record = await prisma.recurringIncome.findFirst({ where: { id, userId: user.sub } })
  if (!record) return NextResponse.json({ error: 'Ingreso no encontrado' }, { status: 404 })

  await prisma.recurringIncome.update({ where: { id }, data: { isActive: false } })
  return NextResponse.json({ ok: true })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
