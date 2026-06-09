import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import { calcMonthlyPayment } from '@/lib/msi/amortization'
import type { JwtPayload } from '@/lib/auth/jwt'

const createSchema = z.object({
  accountId:    z.string().cuid(),
  description:  z.string().min(1).max(200),
  vendor:       z.string().max(100).optional(),
  totalAmount:  z.number().positive(),
  months:       z.number().int().min(1).max(60),
  interestRate: z.number().min(0).max(5).nullable().optional(),
  startDate:    z.string().datetime(),
})

export const GET = withAuth(async (_req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const credits = await prisma.mSICredit.findMany({
    where:   { userId: user.sub },
    orderBy: [{ status: 'asc' }, { endDate: 'asc' }],
    include: { account: { select: { id: true, name: true, color: true, type: true } } },
  })

  // Add progress percentage and months remaining
  const now = new Date()
  return NextResponse.json(
    credits.map(c => ({
      ...c,
      monthsRemaining:   c.months - c.paidMonths,
      progressPercent:   Math.round((c.paidMonths / c.months) * 100),
      pendingTotal:      Number(c.monthlyAmount) * (c.months - c.paidMonths),
      isCurrentlyDue:    c.status === 'ACTIVE' && c.endDate >= now,
    }))
  )
})

export const POST = withAuth(async (req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten().fieldErrors }, { status: 422 })
  }

  const account = await prisma.account.findFirst({
    where: { id: parsed.data.accountId, userId: user.sub, type: 'CREDIT' },
  })
  if (!account) return NextResponse.json({ error: 'Solo se pueden vincular MSI a tarjetas de crédito' }, { status: 422 })

  const { totalAmount, months, interestRate, startDate } = parsed.data
  const start = new Date(startDate)
  const end   = new Date(start)
  end.setMonth(end.getMonth() + months)

  const monthlyAmount = calcMonthlyPayment(totalAmount, months, interestRate ?? null)

  const credit = await prisma.mSICredit.create({
    data: {
      userId:       user.sub,
      accountId:    parsed.data.accountId,
      description:  parsed.data.description,
      vendor:       parsed.data.vendor,
      totalAmount,
      months,
      monthlyAmount,
      interestRate: interestRate ?? null,
      startDate:    start,
      endDate:      end,
      status:       'ACTIVE',
    },
  })
  return NextResponse.json(credit, { status: 201 })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
