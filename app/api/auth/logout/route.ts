import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { clearRefreshCookie } from '@/lib/auth/middleware'

export async function POST(req: NextRequest) {
  const cookieHeader = req.headers.get('cookie') ?? ''
  const match = cookieHeader.match(/refresh_token=([^;]+)/)
  const token = match?.[1]

  if (token) {
    // Revoke the refresh token so it can't be reused
    await prisma.refreshToken.updateMany({
      where: { token, revokedAt: null },
      data: { revokedAt: new Date() },
    }).catch(() => {}) // silently ignore if already gone
  }

  const res = NextResponse.json({ message: 'Sesión cerrada' })
  res.headers.set('Set-Cookie', clearRefreshCookie())
  return res
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}
