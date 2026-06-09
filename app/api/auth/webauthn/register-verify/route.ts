import { NextRequest, NextResponse } from 'next/server'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { withAuth } from '@/lib/auth/middleware'
import { prisma } from '@/lib/prisma'
import { challengeStore } from '../register-options/route'
import type { JwtPayload } from '@/lib/auth/jwt'

export const POST = withAuth(async (req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Body inválido' }, { status: 400 })

  const expectedChallenge = challengeStore.get(user.sub)
  if (!expectedChallenge) {
    return NextResponse.json({ error: 'Challenge expirado. Vuelve a intentarlo.' }, { status: 400 })
  }

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:4200',
      expectedRPID: process.env.WEBAUTHN_RP_ID ?? 'localhost',
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error de verificación'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: 'Verificación fallida' }, { status: 400 })
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo

  await prisma.webAuthnCredential.create({
    data: {
      userId: user.sub,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      deviceType: credentialDeviceType,
      transports: body.response?.transports ?? [],
    },
  })

  challengeStore.delete(user.sub)

  return NextResponse.json({ verified: true, credentialBackedUp })
})

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}
