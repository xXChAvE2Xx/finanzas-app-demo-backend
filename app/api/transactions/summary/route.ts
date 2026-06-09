import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import type { JwtPayload } from '@/lib/auth/jwt'

/**
 * GET /api/transactions/summary?from=&to=
 *
 * Monthly totals for the Dashboard "Este mes" card.
 *
 * Business rules:
 *  - Total Ingresos  = SUM(amount) WHERE type = 'INCOME'  in range
 *  - Total Gastos    = SUM(amount) WHERE type = 'EXPENSE' in range
 *  - CRITICAL: exclude card payments / transfers from BOTH totals so paying a
 *    credit card never inflates income nor expense (avoids double counting).
 *      → excluded when type = 'TRANSFER' OR notes = 'TDC_PAYMENT'
 *  - MSI (cash-flow view): the full-amount purchase row (notes = 'MSI') is
 *    NOT counted. Instead we add only the monthly installment(s) of every
 *    active credit whose due date falls inside the range, so a 12-MSI buy
 *    hits "Te queda" one payment at a time (not the whole amount up front).
 *  - Te queda = Ingresos − Gastos
 *
 * Equivalent SQL (expense side, simplified):
 *   SELECT COALESCE(SUM(amount) FILTER (WHERE type = 'EXPENSE'), 0)
 *   FROM transactions
 *   WHERE "userId" = $1 AND date >= $2 AND date <= $3
 *     AND type <> 'TRANSFER'
 *     AND ("notes" IS DISTINCT FROM 'TDC_PAYMENT')
 *     AND ("notes" IS DISTINCT FROM 'MSI');
 *   -- plus the MSI installments due in range, summed from MSICredit.
 */
export const GET = withAuth(async (req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to   = searchParams.get('to')

  const fromDate = from ? new Date(from) : null
  const toDate   = to   ? new Date(to)   : null

  // Base filter shared by both aggregates — the critical exclusions live here.
  // NULL-SAFE NOTE: in Prisma both `NOT: { notes: 'X' }` and `notes: { not: 'X' }`
  // compile to `NOT(notes = 'X')`, which is NULL (→ falsy) for rows where
  // notes IS NULL — silently dropping every ordinary expense (no notes). We must
  // keep NULL-notes rows explicitly, so the exclusion is expressed as:
  //   notes IS NULL OR notes NOT IN ('TDC_PAYMENT', 'MSI')
  const base: any = {
    userId: user.sub,
    type:   { not: 'TRANSFER' as const },     // exclude traspasos/transferencias
    account: { isActive: true },              // ignore transactions of deleted accounts
    OR: [
      { notes: null },                                     // keep rows without notes
      { notes: { notIn: ['TDC_PAYMENT', 'MSI'] } },        // exclude card payments + full-amount MSI row
    ],
  }
  if (fromDate || toDate) {
    base.date = {}
    if (fromDate) base.date.gte = fromDate
    if (toDate)   base.date.lte = toDate
  }

  const [incomeAgg, expenseAgg, msiCredits] = await Promise.all([
    prisma.transaction.aggregate({ _sum: { amount: true }, where: { ...base, type: 'INCOME' } }),
    prisma.transaction.aggregate({ _sum: { amount: true }, where: { ...base, type: 'EXPENSE' } }),
    prisma.mSICredit.findMany({
      where:  { userId: user.sub, status: { not: 'CANCELLED' } },
      select: { startDate: true, months: true, monthlyAmount: true },
    }),
  ])

  // Sum every MSI installment whose due date (startDate + i months, i=1..months)
  // falls inside the requested range. For a single-month range that's 0 or 1 per
  // credit — the payment owed this month.
  let msiExpense = 0
  for (const c of msiCredits) {
    for (let i = 1; i <= c.months; i++) {
      const due = new Date(c.startDate)
      due.setMonth(due.getMonth() + i)
      if ((!fromDate || due >= fromDate) && (!toDate || due <= toDate)) {
        msiExpense += Number(c.monthlyAmount)
      }
    }
  }

  const totalIncome  = Number(incomeAgg._sum.amount ?? 0)
  const totalExpense = Math.round((Number(expenseAgg._sum.amount ?? 0) + msiExpense) * 100) / 100

  return NextResponse.json({
    totalIncome,
    totalExpense,
    net: Math.round((totalIncome - totalExpense) * 100) / 100,
  })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
