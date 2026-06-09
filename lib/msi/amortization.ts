import { Decimal } from '@prisma/client/runtime/library'

export interface AmortizationRow {
  month: number
  date: Date
  payment: number
  interest: number
  principal: number
  balance: number
}

/**
 * Calcula la cuota mensual usando el método francés (amortización constante).
 * Para MSI puro (interestRate=0 o null): cuota = totalAmount / months
 */
export function calcMonthlyPayment(
  totalAmount: number,
  months: number,
  annualRate: number | null
): number {
  if (!annualRate || annualRate === 0) {
    return round2(totalAmount / months)
  }
  const r = annualRate / 12
  const pmt = totalAmount * (r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1)
  return round2(pmt)
}

/**
 * Genera la tabla de amortización completa para un crédito.
 */
export function buildAmortizationTable(
  totalAmount: number,
  months: number,
  annualRate: number | null,
  startDate: Date
): AmortizationRow[] {
  const monthlyRate = (annualRate ?? 0) / 12
  const monthlyPayment = calcMonthlyPayment(totalAmount, months, annualRate)
  const rows: AmortizationRow[] = []

  let balance = totalAmount
  for (let i = 1; i <= months; i++) {
    const date = new Date(startDate)
    date.setMonth(date.getMonth() + i)

    const interest = round2(balance * monthlyRate)
    const principal = round2(monthlyPayment - interest)
    balance = round2(balance - principal)

    rows.push({
      month: i,
      date,
      payment: monthlyPayment,
      interest,
      principal,
      balance: Math.max(0, balance),
    })
  }
  return rows
}

/**
 * Calcula el "Pago para no generar intereses" en una TDC para el periodo actual.
 *
 * = Gastos corrientes del periodo (entre corte anterior y corte actual)
 * + Suma de mensualidades MSI activas que vencen este ciclo en esa TDC
 */
export function calcPaymentToAvoidInterest(
  currentPeriodExpenses: number,
  activeMsiCredits: Array<{ monthlyAmount: number | Decimal }>
): number {
  const msiTotal = activeMsiCredits.reduce(
    (sum, c) => sum + Number(c.monthlyAmount),
    0
  )
  return round2(currentPeriodExpenses + msiTotal)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
