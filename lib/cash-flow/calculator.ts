import { prisma } from '../prisma'

export interface CashFlowResult {
  periodStart: Date
  periodEnd: Date        // próxima fecha de ingreso
  totalIncome: number   // ingresos esperados en el periodo
  obligations: ObligationItem[]
  totalObligations: number
  freeCashFlow: number  // flujo libre real
  accounts: AccountSummary[]
  totalBalance: number
}

export interface ObligationItem {
  label: string
  amount: number
  dueDate: Date
  type: 'TDC_MINIMUM' | 'MSI' | 'OTHER'
  accountId: string
}

export interface AccountSummary {
  id: string
  name: string
  type: string
  balance: number
  color: string
}

/**
 * Calcula el flujo libre real del usuario para el periodo actual.
 *
 * Algoritmo:
 * 1. Encuentra la próxima fecha de ingreso recurrente (nextDate)
 * 2. Suma todos los ingresos esperados hasta esa fecha
 * 3. Identifica todas las obligaciones (pagos TDC, MSI) que vencen antes de esa fecha
 * 4. Flujo libre = ingresos - obligaciones
 */
export async function calcCashFlow(userId: string): Promise<CashFlowResult> {
  const now = new Date()

  // ── 1. Ingresos recurrentes activos ───────────────────────
  const incomes = await prisma.recurringIncome.findMany({
    where: { userId, isActive: true },
    orderBy: { nextDate: 'asc' },
  })

  // La próxima fecha de ingreso más cercana define el horizonte
  const nextIncomeDate = incomes.length > 0 ? incomes[0].nextDate : addDays(now, 30)

  // Suma todos los ingresos que caen entre hoy y nextIncomeDate (inclusive)
  const relevantIncomes = incomes.filter(i => i.nextDate <= nextIncomeDate)
  const totalIncome = relevantIncomes.reduce((s, i) => s + Number(i.amount), 0)

  // ── 2. Obligaciones hasta nextIncomeDate ──────────────────
  const obligations: ObligationItem[] = []

  // TDC: minimums con fecha de pago en el horizonte
  const creditAccounts = await prisma.account.findMany({
    where: { userId, type: 'CREDIT', isActive: true },
  })

  for (const acc of creditAccounts) {
    if (!acc.paymentDueDay || !acc.cutDay) continue
    const payDue = nextDayOfMonth(acc.paymentDueDay, now)
    if (payDue <= nextIncomeDate && Number(acc.minimumPayment ?? 0) > 0) {
      obligations.push({
        label: `Pago mínimo ${acc.name}`,
        amount: Number(acc.minimumPayment),
        dueDate: payDue,
        type: 'TDC_MINIMUM',
        accountId: acc.id,
      })
    }
  }

  // MSI: mensualidades activas que vencen antes del próximo ingreso
  const activeMsi = await prisma.mSICredit.findMany({
    where: { userId, status: 'ACTIVE', endDate: { gte: now } },
    include: { account: true },
  })

  for (const msi of activeMsi) {
    const msiDue = addDays(msi.startDate, 30 * (msi.paidMonths + 1))
    if (msiDue <= nextIncomeDate) {
      obligations.push({
        label: `MSI ${msi.description} (${msi.account.name})`,
        amount: Number(msi.monthlyAmount),
        dueDate: msiDue,
        type: 'MSI',
        accountId: msi.accountId,
      })
    }
  }

  const totalObligations = obligations.reduce((s, o) => s + o.amount, 0)
  const freeCashFlow = totalIncome - totalObligations

  // ── 3. Balances actuales de todas las cuentas ─────────────
  const accounts = await prisma.account.findMany({
    where: { userId, isActive: true },
  })

  const accountSummaries: AccountSummary[] = accounts.map(a => ({
    id: a.id,
    name: a.name,
    type: a.type,
    balance: Number(a.currentBalance ?? 0),
    color: a.color,
  }))

  const totalBalance = accountSummaries
    .filter(a => a.type !== 'CREDIT') // crédito es deuda, no suma al balance
    .reduce((s, a) => s + a.balance, 0)

  return {
    periodStart: now,
    periodEnd: nextIncomeDate,
    totalIncome,
    obligations: obligations.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()),
    totalObligations,
    freeCashFlow,
    accounts: accountSummaries,
    totalBalance,
  }
}

// ── Helpers ───────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function nextDayOfMonth(day: number, from: Date): Date {
  const d = new Date(from)
  d.setDate(day)
  if (d <= from) d.setMonth(d.getMonth() + 1)
  return d
}
