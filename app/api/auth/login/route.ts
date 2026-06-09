import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifyPassword } from '@/lib/auth/password'
import { signAccessToken, signRefreshToken } from '@/lib/auth/jwt'
import { buildRefreshCookie } from '@/lib/auth/middleware'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const REFRESH_MAX_AGE = 60 * 60 * 24 * 7

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 422 })
  }

  const { email, password } = parsed.data

  // Use a generic error to prevent user enumeration attacks
  const GENERIC_ERROR = NextResponse.json({ error: 'Email o contraseña incorrectos' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { email },
    include: { subscription: true },
  })
  if (!user || !user.passwordHash) return GENERIC_ERROR

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) return GENERIC_ERROR

  const plan = user.subscription?.plan ?? 'FREE'
  const accessToken = signAccessToken({ sub: user.id, email: user.email, plan })
  const refreshToken = signRefreshToken(user.id)
  const expiresAt = new Date(Date.now() + REFRESH_MAX_AGE * 1000)

  await prisma.refreshToken.create({
    data: { userId: user.id, token: refreshToken, expiresAt },
  })

  const res = NextResponse.json({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      encryptionSalt: user.encryptionSalt,
      plan,
    },
  })
  res.headers.set('Set-Cookie', buildRefreshCookie(refreshToken, REFRESH_MAX_AGE))
  return res
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}
