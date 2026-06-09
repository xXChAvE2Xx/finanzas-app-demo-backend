import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import type { JwtPayload } from '@/lib/auth/jwt'

const subscribeSchema = z.object({
  endpoint:  z.string().url(),
  p256dh:    z.string(),
  auth:      z.string(),
  userAgent: z.string().optional(),
})

export const POST = withAuth(async (req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const body = await req.json().catch(() => null)
  const parsed = subscribeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Suscripción inválida' }, { status: 422 })
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint: parsed.data.endpoint },
    update: { p256dh: parsed.data.p256dh, auth: parsed.data.auth },
    create: { userId: user.sub, ...parsed.data },
  })

  return NextResponse.json({ message: 'Suscripción registrada' })
})

export const DELETE = withAuth(async (req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const { searchParams } = new URL(req.url)
  const endpoint = searchParams.get('endpoint')
  if (!endpoint) return NextResponse.json({ error: 'endpoint requerido' }, { status: 400 })

  await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId: user.sub },
  })

  return NextResponse.json({ message: 'Suscripción eliminada' })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
