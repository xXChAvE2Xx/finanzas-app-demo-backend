import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { prisma } from '@/lib/prisma'
import type { JwtPayload } from '@/lib/auth/jwt'

/**
 * POST /api/subscription/upgrade — pasarela simulada (demo, sin cargo real).
 * Activa el plan PREMIUM del usuario autenticado.
 *
 * skipDeviceGate: el caso de uso principal es justamente un usuario
 * FREE bloqueado en desktop que paga para desbloquearse; el gate
 * móvil-only no debe impedir la contratación.
 *
 * El claim `plan` del access token vigente sigue siendo FREE hasta
 * que el cliente llame a POST /auth/refresh (que relee el plan de la
 * BD y firma un token nuevo).
 */
export const POST = withAuth(async (_req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const subscription = await prisma.subscription.upsert({
    where: { userId: user.sub },
    update: { plan: 'PREMIUM', status: 'ACTIVE', startDate: new Date(), endDate: null, provider: 'demo' },
    create: { userId: user.sub, plan: 'PREMIUM', status: 'ACTIVE', provider: 'demo' },
  })

  return NextResponse.json({ plan: subscription.plan, status: subscription.status })
}, { skipDeviceGate: true })

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}
