import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import type { JwtPayload } from '@/lib/auth/jwt'
import { parseRango, rangeWindow } from '@/lib/analisis/range'

/**
 * GET /api/movimientos?categoria_id=[id]&rango=[semana|mes|semestre|anio]
 *
 * Detailed expense transactions for a single category within a time range,
 * feeding the Análisis Bottom Sheet. The filter mirrors /analisis/gastos exactly
 * so the listed rows always add up to that category's slice of the pie.
 *
 * - `categoria_id` omitted (or "null") → the synthetic "Sin categoría" bucket
 *   (rows with categoryId = null).
 * - Same exclusions as the aggregate: type = 'EXPENSE', not 'TDC_PAYMENT'.
 *
 * Response: { categoriaId, rango, from, to, total, count, movimientos: [...] }
 * Each movimiento: { id, fecha, concepto, monto, notes, account }.
 */
export const GET = withAuth(async (req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const { searchParams } = new URL(req.url)
  const rango = parseRango(searchParams.get('rango'))
  const { from, to } = rangeWindow(rango)

  const rawCat = searchParams.get('categoria_id')
  // Treat empty string / "null" / "none" as the uncategorized bucket.
  const categoriaId = rawCat && rawCat !== 'null' && rawCat !== 'none' ? rawCat : null

  const where = {
    userId:     user.sub,
    type:       'EXPENSE' as const,
    date:       { gte: from, lte: to },
    account:    { isActive: true },   // ignore transactions of deleted accounts
    categoryId: categoriaId,   // null → uncategorized rows
    // Null-safe exclusion of card payments — see /analisis/gastos for the why:
    // a plain `NOT`/`not` would drop every row with NULL notes (most expenses).
    OR: [{ notes: null }, { notes: { not: 'TDC_PAYMENT' } }],
  }

  const movimientos = await prisma.transaction.findMany({
    where,
    orderBy: { date: 'desc' },
    select: {
      id:          true,
      date:        true,
      description: true,
      amount:      true,
      notes:       true,
      account:     { select: { id: true, name: true, color: true, type: true } },
    },
  })

  const total = movimientos.reduce((acc, m) => acc + Number(m.amount), 0)

  return NextResponse.json({
    categoriaId,
    rango,
    from:  from.toISOString(),
    to:    to.toISOString(),
    total: Math.round(total * 100) / 100,
    count: movimientos.length,
    movimientos: movimientos.map(m => ({
      id:       m.id,
      fecha:    m.date.toISOString(),
      concepto: m.description,
      monto:    Number(m.amount),
      notes:    m.notes,
      account:  m.account,
    })),
  })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
