import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import type { JwtPayload } from '@/lib/auth/jwt'

const createSchema = z.object({
  name:  z.string().min(1).max(60),
  type:  z.enum(['INCOME', 'EXPENSE']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
  icon:  z.string().optional(),
  group: z.string().min(1).max(40).default('Otros'),
})

// Display order for the grouped response (groups not listed fall to the end, alphabetical)
const GROUP_ORDER = [
  // income
  'Ingresos fijos', 'Ingresos variables', 'Otros ingresos',
  // expense
  'Hogar', 'Alimentación', 'Transporte', 'Salud', 'Ocio', 'Compras',
  'Educación', 'Finanzas', 'Mascotas', 'Otros',
]

export const GET = withAuth(async (_req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const categories = await prisma.category.findMany({
    where: { OR: [{ isSystem: true }, { userId: user.sub }] },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
  })

  // Group by the new "group" column → { "Hogar": [...], "Ocio": [...] }
  const grouped: Record<string, typeof categories> = {}
  for (const cat of categories) {
    const key = cat.group || 'Otros'
    ;(grouped[key] ??= []).push(cat)
  }

  // Return groups in a stable, sensible order
  const ordered: Record<string, typeof categories> = {}
  const keys = Object.keys(grouped).sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a)
    const ib = GROUP_ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
  for (const k of keys) ordered[k] = grouped[k]

  return NextResponse.json(ordered)
})

export const POST = withAuth(async (req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten().fieldErrors }, { status: 422 })
  }

  const existing = await prisma.category.findFirst({
    where: { userId: user.sub, name: parsed.data.name, type: parsed.data.type },
  })
  if (existing) return NextResponse.json({ error: 'Ya existe una categoría con ese nombre' }, { status: 409 })

  const category = await prisma.category.create({
    data: { ...parsed.data, userId: user.sub, isSystem: false },
  })
  return NextResponse.json(category, { status: 201 })
  // note: `group` flows through from parsed.data (defaults to 'Otros')
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
