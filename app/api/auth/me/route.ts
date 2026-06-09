import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { prisma } from '@/lib/prisma'
import type { JwtPayload } from '@/lib/auth/jwt'

export const GET = withAuth(async (_req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const dbUser = await prisma.user.findUnique({
    where: { id: user.sub },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      encryptionSalt: true,
      createdAt: true,
      subscription: { select: { plan: true, status: true, endDate: true } },
    },
  })

  if (!dbUser) {
    return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
  }

  return NextResponse.json({
    ...dbUser,
    plan: dbUser.subscription?.plan ?? 'FREE',
  })
})

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}
