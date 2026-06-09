import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import type { JwtPayload } from '@/lib/auth/jwt'

export const GET = withAuth(async (_req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const [created, participating] = await Promise.all([
    prisma.splitLink.findMany({
      where:   { creatorId: user.sub },
      orderBy: { createdAt: 'desc' },
      include: {
        participants: {
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    }),
    prisma.splitParticipant.findMany({
      where:   { userId: user.sub },
      include: {
        splitLink: {
          include: {
            creator: { select: { id: true, name: true, email: true } },
          },
        },
      },
    }),
  ])

  return NextResponse.json({
    created: created.map(s => ({
      ...s,
      shareUrl: `${process.env.NEXT_PUBLIC_APP_URL}/split/${s.token}`,
      paidCount: s.participants.filter(p => p.status === 'PAID').length,
      totalCount: s.participants.length,
    })),
    participating,
  })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
