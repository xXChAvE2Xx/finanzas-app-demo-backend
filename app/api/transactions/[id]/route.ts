import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import type { JwtPayload } from '@/lib/auth/jwt'

const updateSchema = z.object({
  categoryId:  z.string().cuid().optional(),
  amount:      z.number().positive().optional(),
  description: z.string().min(1).max(200).optional(),
  date:        z.string().datetime().optional(),
  notes:       z.string().max(500).optional(),
})

export const PATCH = withAuth(async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const { id } = await ctx.params
  const original = await prisma.transaction.findFirst({ where: { id, userId: user.sub } })
  if (!original) return NextResponse.json({ error: 'Transacción no encontrada' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten().fieldErrors }, { status: 422 })
  }

  const updated = await prisma.$transaction(async (prx) => {
    // If amount changed, adjust account balance
    if (parsed.data.amount !== undefined && parsed.data.amount !== Number(original.amount)) {
      const oldDelta = original.type === 'INCOME' ? Number(original.amount) : -Number(original.amount)
      const newDelta = original.type === 'INCOME' ? parsed.data.amount : -parsed.data.amount
      await prx.account.update({
        where: { id: original.accountId },
        data:  { currentBalance: { increment: newDelta - oldDelta } },
      })
    }

    return prx.transaction.update({
      where: { id },
      data:  {
        ...parsed.data,
        date: parsed.data.date ? new Date(parsed.data.date) : undefined,
      },
    })
  })

  return NextResponse.json(updated)
})

export const DELETE = withAuth(async (_req: NextRequest, ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const { id } = await ctx.params
  const original = await prisma.transaction.findFirst({ where: { id, userId: user.sub } })
  if (!original) return NextResponse.json({ error: 'Transacción no encontrada' }, { status: 404 })

  await prisma.$transaction(async (prx) => {
    // Reverse the balance change
    const delta = original.type === 'INCOME' ? -Number(original.amount) : Number(original.amount)
    await prx.account.update({
      where: { id: original.accountId },
      data:  { currentBalance: { increment: delta } },
    })
    await prx.transaction.delete({ where: { id } })
  })

  return NextResponse.json({ message: 'Transacción eliminada' })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
