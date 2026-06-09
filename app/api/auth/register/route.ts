import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth/password'
import { signAccessToken, signRefreshToken } from '@/lib/auth/jwt'
import { buildRefreshCookie } from '@/lib/auth/middleware'
import { randomBytes } from 'crypto'

const registerSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  name: z.string().min(2, 'Nombre muy corto').max(100),
})

const REFRESH_MAX_AGE = 60 * 60 * 24 * 7 // 7 días en segundos

export async function POST(req: NextRequest) {
  // ── 1. Validar body ──────────────────────────────────────
  const body = await req.json().catch(() => null)
  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Datos inválidos', details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    )
  }

  const { email, password, name } = parsed.data

  // ── 2. Verificar email único ─────────────────────────────
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'El email ya está registrado' }, { status: 409 })
  }

  // ── 3. Crear usuario + suscripción FREE ──────────────────
  const passwordHash = await hashPassword(password)
  const encryptionSalt = randomBytes(16).toString('hex')

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      encryptionSalt,
      subscription: {
        create: { plan: 'FREE', status: 'ACTIVE' },
      },
    },
    include: { subscription: true },
  })

  // ── 4. Emitir tokens ─────────────────────────────────────
  const plan = user.subscription?.plan ?? 'FREE'
  const accessToken = signAccessToken({ sub: user.id, email: user.email, plan })
  const refreshToken = signRefreshToken(user.id)
  const expiresAt = new Date(Date.now() + REFRESH_MAX_AGE * 1000)

  await prisma.refreshToken.create({
    data: { userId: user.id, token: refreshToken, expiresAt },
  })

  const res = NextResponse.json(
    {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        encryptionSalt: user.encryptionSalt,
        plan,
      },
    },
    { status: 201 }
  )
  res.headers.set('Set-Cookie', buildRefreshCookie(refreshToken, REFRESH_MAX_AGE))
  return res
}

// CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}
