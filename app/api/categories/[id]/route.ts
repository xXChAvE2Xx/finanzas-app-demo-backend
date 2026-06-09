import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import type { JwtPayload } from '@/lib/auth/jwt'

export const DELETE = withAuth(async (_req: NextRequest, ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const { id } = await ctx.params
  const category = await prisma.category.findFirst({
    where: { id, userId: user.sub, isSystem: false },
  })
  if (!category) return NextResponse.json({ error: 'Categoría no encontrada o es del sistema' }, { status: 404 })

  await prisma.category.delete({ where: { id } })
  return NextResponse.json({ message: 'Categoría eliminada' })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
