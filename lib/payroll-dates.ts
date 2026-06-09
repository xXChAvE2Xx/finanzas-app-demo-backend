/**
 * Payroll date calculation utilities.
 *
 * BIWEEKLY (quincenal): two paydays per month.
 *   - 1st quincena: dayOfMonth (default 15)
 *   - 2nd quincena: dayOfMonth + 15, capped at last day of month
 *
 * Weekend adjustment: if the computed date falls on Saturday → previous Friday,
 * if Sunday → 2 days back (Friday).
 */

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/** Moves a date to the previous Friday if it lands on Sat or Sun. */
export function adjustForWeekend(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay() // 0=Sun, 6=Sat
  if (day === 6) d.setDate(d.getDate() - 1) // Sat → Fri
  if (day === 0) d.setDate(d.getDate() - 2) // Sun → Fri
  return d
}

/** Returns the two quincena dates for a given month. */
function quincenaDates(year: number, month: number, day1: number): [Date, Date] {
  const day2 = Math.min(day1 + 15, daysInMonth(year, month))
  return [
    new Date(year, month, day1),
    new Date(year, month, day2),
  ]
}

/**
 * Calculates the next scheduled income date after `now`.
 * Handles all periodicities and optionally adjusts for weekends.
 */
export function calcNextDate(
  startDate: Date,
  periodicity: string,
  dayOfMonth: number | null | undefined,
  adjustWeekends: boolean,
): Date {
  const now = new Date()
  now.setHours(0, 0, 0, 0)

  let next: Date

  switch (periodicity) {
    case 'BIWEEKLY': {
      // Twice a month: day1 and day1+15
      const d1 = dayOfMonth ?? 15
      const year  = now.getFullYear()
      const month = now.getMonth()

      const [q1, q2] = quincenaDates(year, month, d1)

      if (now < q1) {
        next = q1
      } else if (now < q2) {
        next = q2
      } else {
        // Both passed this month → first quincena next month
        const nextMonth = month === 11 ? 0 : month + 1
        const nextYear  = month === 11 ? year + 1 : year
        next = quincenaDates(nextYear, nextMonth, d1)[0]
      }
      break
    }

    case 'MONTHLY': {
      const targetDay = dayOfMonth ?? startDate.getDate()
      let d = new Date(now.getFullYear(), now.getMonth(), targetDay)
      if (d <= now) d = new Date(d.getFullYear(), d.getMonth() + 1, targetDay)
      next = d
      break
    }

    case 'WEEKLY': {
      const d = new Date(startDate)
      while (d <= now) d.setDate(d.getDate() + 7)
      next = d
      break
    }

    case 'DAILY': {
      next = new Date(now)
      next.setDate(next.getDate() + 1)
      break
    }

    case 'BIMONTHLY': {
      const d = new Date(startDate)
      while (d <= now) d.setDate(d.getDate() + 60)
      next = d
      break
    }

    case 'QUARTERLY': {
      const d = new Date(startDate)
      while (d <= now) d.setMonth(d.getMonth() + 3)
      next = d
      break
    }

    case 'ANNUAL': {
      const d = new Date(startDate)
      while (d <= now) d.setFullYear(d.getFullYear() + 1)
      next = d
      break
    }

    default: {
      const d = new Date(startDate)
      while (d <= now) d.setDate(d.getDate() + 30)
      next = d
    }
  }

  return adjustWeekends ? adjustForWeekend(next) : next
}

/**
 * Returns all dates from `afterDate` up to `upTo` for a given periodicity.
 * Used to generate multiple missed payroll deposits.
 * Capped at 24 occurrences to avoid runaway loops.
 */
export function getDueDates(
  startDate: Date,
  periodicity: string,
  dayOfMonth: number | null | undefined,
  adjustWeekends: boolean,
  afterDate: Date,
  upTo: Date,
): Date[] {
  const dates: Date[] = []
  let cursor = new Date(afterDate)
  cursor.setHours(0, 0, 0, 0)

  const end = new Date(upTo)
  end.setHours(23, 59, 59, 999)

  let safety = 0

  while (safety++ < 24) {
    const next = calcNextDate(startDate, periodicity, dayOfMonth, adjustWeekends)

    // Advance `startDate` proxy — recalc from cursor perspective
    const simulated = calcNextAfter(cursor, periodicity, dayOfMonth, adjustWeekends)
    if (simulated > end) break
    dates.push(simulated)
    cursor = new Date(simulated)
    cursor.setDate(cursor.getDate() + 1)
  }

  return dates
}

/** Calculates the next occurrence strictly after a given date. */
function calcNextAfter(
  after: Date,
  periodicity: string,
  dayOfMonth: number | null | undefined,
  adjustWeekends: boolean,
): Date {
  const ref = new Date(after)
  ref.setHours(0, 0, 0, 0)

  let next: Date

  switch (periodicity) {
    case 'BIWEEKLY': {
      const d1    = dayOfMonth ?? 15
      const year  = ref.getFullYear()
      const month = ref.getMonth()
      const [q1, q2] = quincenaDates(year, month, d1)

      if (ref < q1) { next = q1; break }
      if (ref < q2) { next = q2; break }

      const nm = month === 11 ? 0 : month + 1
      const ny = month === 11 ? year + 1 : year
      next = quincenaDates(ny, nm, d1)[0]
      break
    }

    case 'MONTHLY': {
      const td = dayOfMonth ?? after.getDate()
      let d = new Date(ref.getFullYear(), ref.getMonth(), td)
      if (d <= ref) d = new Date(d.getFullYear(), d.getMonth() + 1, td)
      next = d
      break
    }

    case 'WEEKLY': {
      const d = new Date(ref)
      d.setDate(d.getDate() + 7)
      next = d
      break
    }

    case 'ANNUAL': {
      const d = new Date(ref)
      d.setFullYear(d.getFullYear() + 1)
      next = d
      break
    }

    default: {
      const step: Record<string, number> = { DAILY: 1, BIMONTHLY: 60, QUARTERLY: 90 }
      const d = new Date(ref)
      d.setDate(d.getDate() + (step[periodicity] ?? 30))
      next = d
    }
  }

  return adjustWeekends ? adjustForWeekend(next) : next
}
