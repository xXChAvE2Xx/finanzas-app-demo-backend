import { NextRequest, NextResponse } from 'next/server'
import { generateRegistrationOptions } from '@simplewebauthn/server'
import { withAuth } from '@/lib/auth/middleware'
import { prisma } from '@/lib/prisma'
import type { JwtPayload } from '@/lib/auth/jwt'

// In-memory challenge store (use Redis in production)
export const challengeStore = new Map<string, string>()

export const POST = withAuth(async (_req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const dbUser = await prisma.user.findUnique({
    where: { id: user.sub },
    include: { webAuthnCredentials: true },
  })
  if (!dbUser) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })

  const options = await generateRegistrationOptions({
    rpName: process.env.WEBAUTHN_RP_NAME ?? 'Finanzas App',
    rpID: process.env.WEBAUTHN_RP_ID ?? 'localhost',
    userID: new TextEncoder().encode(dbUser.id),
    userName: dbUser.email,
    userDisplayName: dbUser.name,
    attestationType: 'none',
    excludeCredentials: dbUser.webAuthnCredentials.map((c) => ({
      id: c.credentialId,
      transports: c.transports as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  })

  // Store challenge temporarily (5 min TTL)
  challengeStore.set(user.sub, options.challenge)
  setTimeout(() => challengeStore.delete(user.sub), 5 * 60 * 1000)

  return NextResponse.json(options)
})

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}
