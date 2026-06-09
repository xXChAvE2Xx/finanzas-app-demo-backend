import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { prisma } from '@/lib/prisma'
import { signAccessToken, signRefreshToken } from '@/lib/auth/jwt'
import { buildRefreshCookie } from '@/lib/auth/middleware'
import { authChallengeStore } from '../authenticate-options/route'
import { z } from 'zod'

const schema = z.object({ userId: z.string(), response: z.any() })
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Body inválido' }, { status: 400 })

  const { userId, response } = parsed.data
  const expectedChallenge = authChallengeStore.get(userId)
  if (!expectedChallenge) {
    return NextResponse.json({ error: 'Challenge expirado' }, { status: 400 })
  }

  const credential = await prisma.webAuthnCredential.findFirst({
    where: { userId, credentialId: response.id },
    include: { user: { include: { subscription: true } } },
  })
  if (!credential) {
    return NextResponse.json({ error: 'Credencial no encontrada' }, { status: 404 })
  }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:4200',
      expectedRPID: process.env.WEBAUTHN_RP_ID ?? 'localhost',
      credential: {
        id: credential.credentialId,
        publicKey: credential.publicKey,
        counter: Number(credential.counter),
        transports: credential.transports as AuthenticatorTransport[],
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  if (!verification.verified) {
    return NextResponse.json({ error: 'Autenticación fallida' }, { status: 401 })
  }

  // Update counter to prevent replay attacks
  await prisma.webAuthnCredential.update({
    where: { id: credential.id },
    data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() },
  })

  authChallengeStore.delete(userId)

  const user = credential.user
  const plan = user.subscription?.plan ?? 'FREE'
  const accessToken = signAccessToken({ sub: user.id, email: user.email, plan })
  const refreshToken = signRefreshToken(user.id)

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + REFRESH_MAX_AGE * 1000),
    },
  })

  const res = NextResponse.json({
    verified: true,
    accessToken,
    user: { id: user.id, email: user.email, name: user.name, plan },
  })
  res.headers.set('Set-Cookie', buildRefreshCookie(refreshToken, REFRESH_MAX_AGE))
  return res
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}
