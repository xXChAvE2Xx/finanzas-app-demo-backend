import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import { calcMonthlyPayment } from '@/lib/msi/amortization'
import type { JwtPayload } from '@/lib/auth/jwt'

const createSchema = z.object({
  // No exigir formato cuid: los ids del seed son legibles
  // ("demo-account-tdc-1") y la pertenencia se valida abajo contra la BD.
  accountId:    z.string().min(1),
  description:  z.string().min(1).max(200),
  vendor:       z.string().max(100).optional(),
  totalAmount:  z.number().positive(),
  months:       z.number().int().min(1).max(60),
  interestRate: z.number().min(0).max(5).nullable().optional(),
  startDate:    z.string().datetime(),
  // ── Flujo "monto = mensualidad" ──
  // El cliente captura la mensualidad real del estado de cuenta; si viene,
  // se respeta tal cual (no se recalcula con la fórmula de amortización).
  monthlyAmount: z.number().positive().optional(),
  // Mensualidades ya pagadas (mensualidadActual - 1). La deuda restante
  // SIEMPRE se deriva de aquí: (months - paidMonths) * monthlyAmount.
  paidMonths:    z.number().int().min(0).optional(),
}).refine(d => (d.paidMonths ?? 0) <= d.months, {
  message: 'paidMonths no puede exceder months',
  path: ['paidMonths'],
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

  const { totalAmount, months, interestRate, startDate, paidMonths } = parsed.data
  const start = new Date(startDate)
  const end   = new Date(start)
  end.setMonth(end.getMonth() + months)

  // La mensualidad explícita del cliente manda (flujo inverso: el usuario
  // capturó la mensualidad de su estado de cuenta y el total se derivó de
  // ella); solo si no viene se calcula con la amortización clásica.
  const monthlyAmount = parsed.data.monthlyAmount
    ?? calcMonthlyPayment(totalAmount, months, interestRate ?? null)

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
      paidMonths:   paidMonths ?? 0,
      // Compra vieja capturada ya liquidada → nace COMPLETED.
      status:       (paidMonths ?? 0) >= months ? 'COMPLETED' : 'ACTIVE',
    },
  })
  return NextResponse.json(credit, { status: 201 })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
