import { NextRequest, NextResponse } from 'next/server'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// Shared challenge store for auth flow
export const authChallengeStore = new Map<string, string>()

const schema = z.object({ email: z.string().email() })

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Email requerido' }, { status: 422 })

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    include: { webAuthnCredentials: true },
  })

  if (!user || user.webAuthnCredentials.length === 0) {
    return NextResponse.json({ error: 'No hay credenciales biométricas registradas' }, { status: 404 })
  }

  const options = await generateAuthenticationOptions({
    rpID: process.env.WEBAUTHN_RP_ID ?? 'localhost',
    userVerification: 'preferred',
    allowCredentials: user.webAuthnCredentials.map((c) => ({
      id: c.credentialId,
      transports: c.transports as AuthenticatorTransport[],
    })),
  })

  authChallengeStore.set(user.id, options.challenge)
  setTimeout(() => authChallengeStore.delete(user.id), 5 * 60 * 1000)

  return NextResponse.json({ ...options, userId: user.id })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}
