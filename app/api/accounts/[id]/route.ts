import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import { encryptLastFour, decryptLastFour } from '@/lib/crypto/encrypt'
import type { JwtPayload } from '@/lib/auth/jwt'

const updateSchema = z.object({
  name:           z.string().min(1).max(100).optional(),
  bank:           z.string().max(100).optional(),
  lastFourDigits: z.string().regex(/^\d{4}$/).optional(),
  color:          z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon:           z.string().optional(),
  notes:          z.string().max(500).optional(),
  currentBalance: z.number().optional(),
  creditLimit:    z.number().positive().optional(),
  cutDebt:        z.number().min(0).optional(),
  cutDay:         z.number().int().min(1).max(31).optional(),
  paymentDueDay:  z.number().int().min(1).max(31).optional(),
  minimumPayment: z.number().positive().optional(),
  interestRate:   z.number().min(0).max(5).optional(),
  isActive:       z.boolean().optional(),
})

async function getAccount(id: string, userId: string) {
  const account = await prisma.account.findFirst({ where: { id, userId } })
  if (!account) return null
  return account
}

export const GET = withAuth(async (_req: NextRequest, ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const { id } = await ctx.params
  const account = await getAccount(id, user.sub)
  if (!account) return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 404 })

  // Decrypt last four for the owner only
  let lastFour: string | undefined
  if (account.lastFourDigits) {
    try { lastFour = decryptLastFour(account.lastFourDigits) } catch { lastFour = undefined }
  }

  const msiCredits = await prisma.mSICredit.findMany({
    where: { accountId: id, status: 'ACTIVE' },
  })

  return NextResponse.json({
    ...account,
    lastFourDigits: lastFour,
    msiCredits,
    totalMonthlyMSI: msiCredits.reduce((s, m) => s + Number(m.monthlyAmount), 0),
    paymentToAvoidInterest: 0, // calculated on cash-flow endpoint
  })
})

export const PATCH = withAuth(async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const { id } = await ctx.params
  const account = await getAccount(id, user.sub)
  if (!account) return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten().fieldErrors }, { status: 422 })
  }

  const data = parsed.data
  const encryptedDigits = data.lastFourDigits ? encryptLastFour(data.lastFourDigits) : undefined

  const updated = await prisma.account.update({
    where: { id },
    data: {
      ...data,
      lastFourDigits: encryptedDigits ?? undefined,
    },
  })

  return NextResponse.json({ ...updated, lastFourDigits: undefined })
})

export const DELETE = withAuth(async (_req: NextRequest, ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const { id } = await ctx.params
  const account = await getAccount(id, user.sub)
  if (!account) return NextResponse.json({ error: 'Cuenta no encontrada' }, { status: 404 })

  // Soft delete
  await prisma.account.update({ where: { id }, data: { isActive: false } })
  return NextResponse.json({ message: 'Cuenta eliminada' })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
