/**
 * Time-range helper shared by the Análisis endpoints.
 *
 * Maps the `rango` query value used by the frontend Choice Chips
 * ([1 sem] · [1 mes] · [6 meses] · [1 año]) to a concrete [from, to] window
 * ending "now". Computing the window server-side guarantees the aggregate
 * (/analisis/gastos) and the detail (/movimientos) always cover the exact same
 * period for a given `rango`.
 */
export type Rango = 'semana' | 'mes' | 'semestre' | 'anio'

const VALID: ReadonlySet<string> = new Set(['semana', 'mes', 'semestre', 'anio'])

/** Narrows an arbitrary string to a valid Rango, defaulting to 'mes'. */
export function parseRango(value: string | null): Rango {
  return value && VALID.has(value) ? (value as Rango) : 'mes'
}

/**
 * Returns the inclusive [from, to] window for a range, with `to = now`.
 * - semana    → últimos 7 días
 * - mes       → último mes
 * - semestre  → últimos 6 meses
 * - anio      → último año
 */
export function rangeWindow(rango: Rango, now: Date = new Date()): { from: Date; to: Date } {
  const from = new Date(now)
  switch (rango) {
    case 'semana':   from.setDate(from.getDate() - 7);   break
    case 'mes':      from.setMonth(from.getMonth() - 1); break
    case 'semestre': from.setMonth(from.getMonth() - 6); break
    case 'anio':     from.setFullYear(from.getFullYear() - 1); break
  }
  return { from, to: now }
}
