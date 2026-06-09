/**
 * POST /api/recurring-income/generate-due
 *
 * Finds all active recurring incomes whose nextDate is today or in the past,
 * creates the corresponding income Transaction(s), updates the account balance,
 * and advances nextDate to the next occurrence.
 *
 * Safe to call multiple times — skips if a transaction for that recurring income
 * and date already exists.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import { calcNextDate } from '@/lib/payroll-dates'
import type { JwtPayload } from '@/lib/auth/jwt'

export const POST = withAuth(async (_req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const today = new Date()
  today.setHours(23, 59, 59, 999)

  // Find all active incomes that are due
  const dueIncomes = await prisma.recurringIncome.findMany({
    where: {
      userId:   user.sub,
      isActive: true,
      nextDate: { lte: today },
    },
    include: { account: true },
  })

  const created: { id: string; description: string; amount: number; date: Date }[] = []

  for (const income of dueIncomes) {
    const payDate = new Date(income.nextDate)

    // Idempotency: skip if we already created a transaction for this exact date
    const existing = await prisma.transaction.findFirst({
      where: {
        recurringIncomeId: income.id,
        date: {
          gte: new Date(payDate.getFullYear(), payDate.getMonth(), payDate.getDate()),
          lte: new Date(payDate.getFullYear(), payDate.getMonth(), payDate.getDate(), 23, 59, 59),
        },
      },
    })
    if (existing) {
      // Still advance nextDate if it's stuck
      const next = calcNextDate(income.startDate, income.periodicity, income.dayOfMonth, income.adjustForWeekends)
      if (next > income.nextDate) {
        await prisma.recurringIncome.update({ where: { id: income.id }, data: { nextDate: next } })
      }
      continue
    }

    const amount = Number(income.amount)

    // Create income transaction
    await prisma.$transaction([
      prisma.transaction.create({
        data: {
          userId:            user.sub,
          accountId:         income.accountId,
          recurringIncomeId: income.id,
          type:              'INCOME',
          amount:            income.amount,
          description:       income.description,
          date:              payDate,
          notes:             `Depósito automático · ${income.periodicity === 'BIWEEKLY' ? 'Quincenal' : income.periodicity}`,
        },
      }),
      // Update account balance
      prisma.account.update({
        where: { id: income.accountId },
        data:  { currentBalance: { increment: amount } },
      }),
      // Advance nextDate
      prisma.recurringIncome.update({
        where: { id: income.id },
        data: {
          nextDate: calcNextDate(income.startDate, income.periodicity, income.dayOfMonth, income.adjustForWeekends),
        },
      }),
    ])

    created.push({
      id:          income.id,
      description: income.description,
      amount,
      date:        payDate,
    })
  }

  return NextResponse.json({ generated: created.length, transactions: created })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
