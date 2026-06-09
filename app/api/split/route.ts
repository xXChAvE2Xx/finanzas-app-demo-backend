import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import { generateSplitToken, SPLIT_TTL } from '@/lib/split/token'
import type { JwtPayload } from '@/lib/auth/jwt'

const participantSchema = z.object({
  userId:     z.string().cuid().optional(),
  guestName:  z.string().max(100).optional(),
  guestEmail: z.string().email().optional(),
  amount:     z.number().positive(),
})

const createSchema = z.object({
  concept:     z.string().min(1).max(200),
  totalAmount: z.number().positive(),
  notes:       z.string().max(500).optional(),
  bankDetails: z.object({
    bank:   z.string().min(1),
    clabe:  z.string().optional(),
    alias:  z.string().optional(),
    phone:  z.string().optional(),
  }),
  participants: z.array(participantSchema).min(1).max(20),
})

export const POST = withAuth(async (req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten().fieldErrors }, { status: 422 })
  }

  // Premium limit: FREE plan can have max 3 active split links
  if (user.plan === 'FREE') {
    const activeCount = await prisma.splitLink.count({
      where: {
        creatorId: user.sub,
        status:    { in: ['PENDING', 'PARTIAL'] },
        expiresAt: { gt: new Date() },
      },
    })
    if (activeCount >= 3) {
      return NextResponse.json(
        { error: 'Plan gratuito: máximo 3 links activos. Actualiza a Premium.', code: 'PREMIUM_REQUIRED' },
        { status: 403 }
      )
    }
  }

  const ttl = user.plan === 'PREMIUM' ? SPLIT_TTL.PREMIUM : SPLIT_TTL.FREE
  const token = generateSplitToken()
  const expiresAt = new Date(Date.now() + ttl)

  const split = await prisma.splitLink.create({
    data: {
      creatorId:   user.sub,
      token,
      concept:     parsed.data.concept,
      totalAmount: parsed.data.totalAmount,
      notes:       parsed.data.notes,
      bankDetails: parsed.data.bankDetails,
      expiresAt,
      participants: {
        create: parsed.data.participants.map(p => ({
          userId:     p.userId ?? null,
          guestName:  p.guestName,
          guestEmail: p.guestEmail,
          amount:     p.amount,
          status:     'PENDING',
        })),
      },
    },
    include: { participants: true },
  })

  // If any participant is a registered user, notify them
  const registeredParticipants = parsed.data.participants.filter(p => p.userId)
  for (const p of registeredParticipants) {
    if (p.userId) {
      await prisma.notification.create({
        data: {
          userId: p.userId,
          type:   'SPLIT_REMINDER',
          title:  '💸 Tienes un cobro pendiente',
          body:   `${parsed.data.concept} — $${p.amount.toFixed(2)}`,
          data:   { splitToken: token, splitLinkId: split.id },
        },
      })
    }
  }

  return NextResponse.json({
    ...split,
    shareUrl: `${process.env.NEXT_PUBLIC_APP_URL}/split/${token}`,
  }, { status: 201 })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
