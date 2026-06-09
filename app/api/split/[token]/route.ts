import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// ── Public endpoint — no auth required ───────────────────────
export async function GET(_req: NextRequest, ctx: { params: Promise<Record<string, string>> }) {
  const { token } = await ctx.params

  const split = await prisma.splitLink.findFirst({
    where: { token },
    include: {
      creator: { select: { name: true, email: true } },
      participants: {
        include: { user: { select: { id: true, name: true } } },
      },
    },
  })

  if (!split) return NextResponse.json({ error: 'Link no encontrado' }, { status: 404 })

  if (split.expiresAt < new Date()) {
    return NextResponse.json({ error: 'Este link ha expirado' }, { status: 410 })
  }

  // Return data needed for the public landing page
  return NextResponse.json({
    token:       split.token,
    concept:     split.concept,
    totalAmount: split.totalAmount,
    notes:       split.notes,
    bankDetails: split.bankDetails,
    status:      split.status,
    expiresAt:   split.expiresAt,
    creator:     split.creator,
    participants: split.participants.map(p => ({
      id:        p.id,
      name:      p.user?.name ?? p.guestName ?? 'Invitado',
      amount:    p.amount,
      status:    p.status,
      paidAt:    p.paidAt,
    })),
  })
}

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
