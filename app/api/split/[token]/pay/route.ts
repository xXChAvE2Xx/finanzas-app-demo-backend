import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifyAccessToken } from '@/lib/auth/jwt'
import { notifyUser } from '@/lib/push/web-push'

const paySchema = z.object({
  participantId: z.string().cuid(),
  guestName:     z.string().max(100).optional(),
  guestEmail:    z.string().email().optional(),
})

// Supports both authenticated and guest users
export async function POST(req: NextRequest, ctx: { params: Promise<Record<string, string>> }) {
  const { token } = await ctx.params
  const body = await req.json().catch(() => null)
  const parsed = paySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten().fieldErrors }, { status: 422 })
  }

  const split = await prisma.splitLink.findFirst({
    where: { token },
    include: { participants: true, creator: true },
  })

  if (!split) return NextResponse.json({ error: 'Link no encontrado' }, { status: 404 })
  if (split.expiresAt < new Date()) return NextResponse.json({ error: 'Link expirado' }, { status: 410 })
  if (split.status === 'COMPLETED') return NextResponse.json({ error: 'Este cobro ya fue completado' }, { status: 409 })

  const participant = split.participants.find(p => p.id === parsed.data.participantId)
  if (!participant) return NextResponse.json({ error: 'Participante no encontrado' }, { status: 404 })
  if (participant.status === 'PAID') return NextResponse.json({ error: 'Ya marcado como pagado' }, { status: 409 })

  // Resolve who is paying (authenticated or guest)
  let payerId: string | null = null
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = verifyAccessToken(authHeader.slice(7))
      payerId = payload.sub
    } catch { /* guest payment */ }
  }

  // Mark participant as paid + inject transaction for registered user
  await prisma.$transaction(async (prx) => {
    await prx.splitParticipant.update({
      where: { id: participant.id },
      data: {
        status:     'PAID',
        paidAt:     new Date(),
        guestName:  parsed.data.guestName ?? participant.guestName,
        guestEmail: parsed.data.guestEmail ?? participant.guestEmail,
        userId:     payerId ?? participant.userId,
      },
    })

    // If authenticated, create a transaction in their account
    if (payerId) {
      const defaultAccount = await prx.account.findFirst({
        where: { userId: payerId, type: { in: ['CHECKING', 'DEBIT'] }, isActive: true },
        orderBy: { createdAt: 'asc' },
      })
      if (defaultAccount) {
        const tx = await prx.transaction.create({
          data: {
            userId:      payerId,
            accountId:   defaultAccount.id,
            type:        'EXPENSE',
            amount:      Number(participant.amount),
            description: `${split.concept} (split)`,
            date:        new Date(),
            syncStatus:  'SYNCED',
          },
        })
        await prx.splitParticipant.update({
          where: { id: participant.id },
          data:  { transactionId: tx.id },
        })
        // Update account balance
        await prx.account.update({
          where: { id: defaultAccount.id },
          data:  { currentBalance: { decrement: Number(participant.amount) } },
        })
      }
    }

    // Check if all paid → mark split as COMPLETED
    const allPaid = split.participants
      .filter(p => p.id !== participant.id)
      .every(p => p.status === 'PAID')

    await prx.splitLink.update({
      where: { id: split.id },
      data:  { status: allPaid ? 'COMPLETED' : 'PARTIAL' },
    })
  })

  // Notify creator
  const payerName = parsed.data.guestName ?? 'Alguien'
  await notifyUser(
    split.creatorId,
    'SPLIT_PAID',
    {
      title: '✅ Pago recibido',
      body:  `${payerName} pagó $${Number(participant.amount).toFixed(2)} de "${split.concept}"`,
    },
    { splitToken: token }
  )

  return NextResponse.json({ message: 'Marcado como pagado', success: true })
}

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
