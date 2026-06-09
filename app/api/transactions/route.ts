import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import type { JwtPayload } from '@/lib/auth/jwt'

/**
 * Whether a payment dated `date` should be applied to the current statement
 * balance (deuda al corte) of a card.
 *
 * @param cutDay  Día del mes en que cierra el estado de cuenta.
 * @param dueDay  Día del mes de la fecha límite de pago (si dueDay ≤ cutDay,
 *                el límite cae el mes siguiente al corte).
 *
 * Window = (corte del mes pasado, fecha límite del corte actual].
 */
function appliesToCutDebt(date: Date, cutDay: number, dueDay?: number): boolean {
  const y = date.getFullYear()
  const m = date.getMonth()
  const currentCut = new Date(y, m, cutDay)        // corte de este mes
  const prevCut    = new Date(y, m - 1, cutDay)    // corte del mes pasado

  let dueDate: Date
  if (dueDay && dueDay >= 1) {
    // dueDay como día del mes: mismo mes si es posterior al corte, si no el siguiente
    dueDate = dueDay > cutDay
      ? new Date(y, m, dueDay)
      : new Date(y, m + 1, dueDay)
  } else {
    dueDate = new Date(currentCut); dueDate.setDate(dueDate.getDate() + 20) // fallback 20 días
  }
  return date > prevCut && date <= dueDate
}

const createSchema = z.object({
  // Account/category ids are not guaranteed cuids in this app (system seed uses
  // custom ids like "demo-account-tdc-1"), so accept any non-empty string.
  accountId:   z.string().min(1),
  categoryId:  z.string().min(1).optional(),
  type:        z.enum(['INCOME', 'EXPENSE', 'TRANSFER']),
  amount:      z.number().positive(),
  description: z.string().min(1).max(200),
  date:        z.string().datetime(),
  notes:       z.string().max(500).optional(),
  clientId:    z.string().optional(), // for offline deduplication
  // For transfers / TDC payments — the account that receives the money
  destinationAccountId: z.string().min(1).optional(),
})

export const GET = withAuth(async (req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const { searchParams } = new URL(req.url)
  const page    = Math.max(1, Number(searchParams.get('page') ?? 1))
  const limit   = Math.min(100, Number(searchParams.get('limit') ?? 30))
  const from    = searchParams.get('from')
  const to      = searchParams.get('to')
  const account = searchParams.get('accountId')
  const type    = searchParams.get('type') as 'INCOME' | 'EXPENSE' | 'TRANSFER' | null
  const catId   = searchParams.get('categoryId')

  const where: any = { userId: user.sub }
  if (from || to) {
    where.date = {}
    if (from) where.date.gte = new Date(from)
    if (to)   where.date.lte = new Date(to)
  }
  if (account)  where.accountId  = account
  if (type)     where.type       = type
  if (catId)    where.categoryId = catId

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { date: 'desc' },
      skip:  (page - 1) * limit,
      take:  limit,
      include: {
        account:  { select: { id: true, name: true, color: true, type: true } },
        category: { select: { id: true, name: true, color: true, icon: true } },
      },
    }),
    prisma.transaction.count({ where }),
  ])

  return NextResponse.json({
    data: transactions,
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  })
})

export const POST = withAuth(async (req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten().fieldErrors }, { status: 422 })
  }

  // Idempotency: if clientId already exists, return the existing record
  if (parsed.data.clientId) {
    const existing = await prisma.transaction.findUnique({
      where: { clientId: parsed.data.clientId },
    })
    if (existing) return NextResponse.json(existing, { status: 200 })
  }

  // Verify the (origin) account belongs to this user
  const account = await prisma.account.findFirst({
    where: { id: parsed.data.accountId, userId: user.sub },
  })
  if (!account) return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 404 })

  // For a transfer / TDC payment, verify the destination account too
  let destination = null
  if (parsed.data.destinationAccountId) {
    destination = await prisma.account.findFirst({
      where: { id: parsed.data.destinationAccountId, userId: user.sub },
    })
    if (!destination) return NextResponse.json({ error: 'Cuenta destino no encontrada' }, { status: 404 })
    if (parsed.data.destinationAccountId === parsed.data.accountId) {
      return NextResponse.json({ error: 'La cuenta origen y destino no pueden ser la misma' }, { status: 422 })
    }
  }

  // ── Guard: liquidity accounts can't go negative ──────────────────────────
  // The account that LOSES money is the origin (transfer) or the account of a
  // regular expense. Credit cards may go up (debt) so they're exempt; MSI
  // injections don't move balance. Block when the outflow exceeds the balance.
  const outflowsFrom =
    destination ? account                                   // transfer → origin
    : parsed.data.type === 'EXPENSE' ? account              // gasto → su cuenta
    : null
  if (outflowsFrom && outflowsFrom.type !== 'CREDIT' && parsed.data.notes !== 'MSI') {
    if (parsed.data.amount > Number(outflowsFrom.currentBalance ?? 0)) {
      return NextResponse.json(
        {
          error: `Saldo insuficiente en ${outflowsFrom.name}. Disponible: ${Number(outflowsFrom.currentBalance ?? 0)}`,
          code: 'INSUFFICIENT_FUNDS',
        },
        { status: 422 }
      )
    }
  }

  const tx = await prisma.$transaction(async (prx) => {
    const transaction = await prx.transaction.create({
      data: {
        userId:            user.sub,
        accountId:         parsed.data.accountId,
        categoryId:        parsed.data.categoryId,
        type:              parsed.data.type,
        amount:            parsed.data.amount,
        description:       parsed.data.description,
        date:              new Date(parsed.data.date),
        notes:             parsed.data.notes,
        clientId:          parsed.data.clientId,
        transferAccountId: parsed.data.destinationAccountId,
        syncStatus:        'SYNCED',
      },
    })

    if (destination) {
      // ── Double-entry transfer / TDC payment (atomic) ──────────────────
      // Origin always loses the money.
      await prx.account.update({
        where: { id: parsed.data.accountId },
        data:  { currentBalance: { decrement: parsed.data.amount } },
      })

      if (destination.type === 'CREDIT') {
        // Pay down the card: currentBalance (deuda total base) goes down…
        const amount = parsed.data.amount
        const data: Record<string, unknown> = { currentBalance: { decrement: amount } }

        // …and, if the payment falls inside the current billing cycle, the
        // statement balance (deuda al corte) is reduced directly too.
        // Available credit (limite_disponible) and deuda_total are derived
        // from these balances, so they update automatically.
        if (destination.cutDay && appliesToCutDebt(new Date(parsed.data.date), destination.cutDay, destination.paymentDueDay ?? undefined)) {
          const currentCut = Number(destination.cutDebt ?? 0)
          data.cutDebt = Math.max(0, currentCut - amount)   // never below zero
        }

        await prx.account.update({ where: { id: parsed.data.destinationAccountId! }, data })
      } else {
        // Regular transfer in: the destination simply receives the money.
        await prx.account.update({
          where: { id: parsed.data.destinationAccountId! },
          data:  { currentBalance: { increment: parsed.data.amount } },
        })
      }
    } else if (parsed.data.notes !== 'MSI') {
      // ── Single-account movement (income / expense) ────────────────────
      // MSI purchases (notes='MSI') do NOT move currentBalance — their debt is
      // tracked separately via MSICredit.pendingTotal and added to the total.
      //
      // Credit cards store debt as a positive balance, so a regular PURCHASE
      // (EXPENSE) increases the balance and a PAYMENT (INCOME) decreases it.
      let delta: number
      if (account.type === 'CREDIT') {
        delta = parsed.data.type === 'EXPENSE' ? parsed.data.amount : -parsed.data.amount
      } else {
        delta = parsed.data.type === 'INCOME' ? parsed.data.amount : -parsed.data.amount
      }
      await prx.account.update({
        where: { id: parsed.data.accountId },
        data:  { currentBalance: { increment: delta } },
      })
    }

    return transaction
  })

  return NextResponse.json(tx, { status: 201 })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
