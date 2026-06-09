import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import type { JwtPayload } from '@/lib/auth/jwt'
import { parseRango, rangeWindow } from '@/lib/analisis/range'

/**
 * GET /api/analisis/gastos?rango=[semana|mes|semestre|anio]
 *
 * Aggregated expenses grouped by category for the requested period, powering the
 * "Análisis" pie chart, its legend and the center total.
 *
 * Business rules (kept consistent with the detail endpoint /movimientos so the
 * pie total always equals the sum of the rows shown when a slice is tapped):
 *   - Only type = 'EXPENSE' rows count.
 *   - Credit-card payments (notes = 'TDC_PAYMENT') are excluded — paying a card
 *     is not spending, it would double count.
 *   - MSI purchase rows (notes = 'MSI') ARE included at their full amount: they
 *     carry a real category and represent where the money was spent. (The
 *     cash-flow "Te queda" view treats MSI differently — that's a separate lens.)
 *   - Rows without a category are bucketed under a synthetic "Sin categoría".
 *
 * Response:
 *   {
 *     rango, from, to,
 *     total,                       // grand total of the period
 *     categorias: [                // sorted desc by monto
 *       { categoriaId, nombre, color, icon, monto, porcentaje, count }
 *     ]
 *   }
 */
export const GET = withAuth(async (req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const { searchParams } = new URL(req.url)
  const rango = parseRango(searchParams.get('rango'))
  const { from, to } = rangeWindow(rango)

  const where = {
    userId:  user.sub,
    type:    'EXPENSE' as const,
    date:    { gte: from, lte: to },
    account: { isActive: true },   // ignore transactions of deleted accounts
    // Null-safe exclusion of card payments. CRITICAL: in Prisma both
    // `NOT: { notes: 'X' }` and field-level `notes: { not: 'X' }` translate to
    // `NOT(notes = 'X')`, which is NULL (→ falsy) for rows where notes IS NULL —
    // so the vast majority of normal expenses (no notes) would silently vanish.
    // The OR keeps NULL-notes rows explicitly while still dropping TDC payments.
    OR: [{ notes: null }, { notes: { not: 'TDC_PAYMENT' } }],
  }

  // Aggregate amount + count per category in a single grouped query.
  const grouped = await prisma.transaction.groupBy({
    by:    ['categoryId'],
    where,
    _sum:  { amount: true },
    _count: { _all: true },
  })

  // Resolve category metadata (name/color/icon) for the categories that appear.
  const ids = grouped.map(g => g.categoryId).filter((id): id is string => !!id)
  const cats = ids.length
    ? await prisma.category.findMany({
        where:  { id: { in: ids } },
        select: { id: true, name: true, color: true, icon: true },
      })
    : []
  const catById = new Map(cats.map(c => [c.id, c]))

  const total = grouped.reduce((acc, g) => acc + Number(g._sum.amount ?? 0), 0)

  const categorias = grouped
    .map(g => {
      const meta = g.categoryId ? catById.get(g.categoryId) : undefined
      const monto = Math.round(Number(g._sum.amount ?? 0) * 100) / 100
      return {
        categoriaId: g.categoryId ?? null,
        nombre:      meta?.name ?? 'Sin categoría',
        color:       meta?.color ?? '#71717a',
        icon:        meta?.icon ?? 'more-horizontal',
        monto,
        porcentaje:  total > 0 ? Math.round((monto / total) * 1000) / 10 : 0,
        count:       g._count._all,
      }
    })
    .sort((a, b) => b.monto - a.monto)

  return NextResponse.json({
    rango,
    from: from.toISOString(),
    to:   to.toISOString(),
    total: Math.round(total * 100) / 100,
    categorias,
  })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
