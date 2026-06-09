import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyRefreshToken, signAccessToken, signRefreshToken } from '@/lib/auth/jwt'
import { buildRefreshCookie, clearRefreshCookie } from '@/lib/auth/middleware'

const REFRESH_MAX_AGE = 60 * 60 * 24 * 7

export async function POST(req: NextRequest) {
  const cookieHeader = req.headers.get('cookie') ?? ''
  const match = cookieHeader.match(/refresh_token=([^;]+)/)
  const incomingToken = match?.[1]

  if (!incomingToken) {
    return NextResponse.json({ error: 'Sin token de refresco' }, { status: 401 })
  }

  // ── Verify signature ─────────────────────────────────────
  let userId: string
  try {
    const payload = verifyRefreshToken(incomingToken)
    userId = payload.sub
  } catch {
    const res = NextResponse.json({ error: 'Token inválido' }, { status: 401 })
    res.headers.set('Set-Cookie', clearRefreshCookie())
    return res
  }

  // ── Validate token exists and is not revoked ─────────────
  const stored = await prisma.refreshToken.findFirst({
    where: { token: incomingToken, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: { include: { subscription: true } } },
  })

  if (!stored) {
    const res = NextResponse.json({ error: 'Token revocado o expirado' }, { status: 401 })
    res.headers.set('Set-Cookie', clearRefreshCookie())
    return res
  }

  // ── Rotate: revoke old, issue new (prevents replay attacks) ─
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  })

  const user = stored.user
  const plan = user.subscription?.plan ?? 'FREE'
  const newAccessToken = signAccessToken({ sub: user.id, email: user.email, plan })
  const newRefreshToken = signRefreshToken(user.id)
  const expiresAt = new Date(Date.now() + REFRESH_MAX_AGE * 1000)

  await prisma.refreshToken.create({
    data: { userId, token: newRefreshToken, expiresAt },
  })

  const res = NextResponse.json({ accessToken: newAccessToken })
  res.headers.set('Set-Cookie', buildRefreshCookie(newRefreshToken, REFRESH_MAX_AGE))
  return res
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}
