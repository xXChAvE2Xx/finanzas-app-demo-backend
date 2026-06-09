import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/auth/middleware'
import type { JwtPayload } from '@/lib/auth/jwt'

const actionSchema = z.object({
  clientId: z.string(),
  method:   z.enum(['POST', 'PUT', 'PATCH', 'DELETE']),
  resource: z.enum(['transactions', 'accounts']),
  payload:  z.unknown(),
})

const batchSchema = z.object({
  actions: z.array(actionSchema).max(50),
})

/**
 * Batch sync endpoint called by the Service Worker's Background Sync.
 * Processes queued offline mutations in order, returning per-action results.
 */
export const POST = withAuth(async (req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const body = await req.json().catch(() => null)
  const parsed = batchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Formato inválido' }, { status: 422 })
  }

  const results: Array<{ clientId: string; status: 'ok' | 'error'; data?: unknown; error?: string }> = []

  for (const action of parsed.data.actions) {
    try {
      if (action.resource === 'transactions' && action.method === 'POST') {
        const data = action.payload as any
        // Idempotency: skip if already exists
        const existing = await prisma.transaction.findUnique({ where: { clientId: action.clientId } })
        if (existing) {
          results.push({ clientId: action.clientId, status: 'ok', data: existing })
          continue
        }
        // Verify the (origin) account belongs to this user
        const account = await prisma.account.findFirst({
          where: { id: data.accountId, userId: user.sub },
        })
        if (!account) {
          results.push({ clientId: action.clientId, status: 'error', error: 'Cuenta no encontrada' })
          continue
        }

        // For a transfer / TDC payment, verify the destination account too
        let destination = null
        if (data.destinationAccountId) {
          destination = await prisma.account.findFirst({
            where: { id: data.destinationAccountId, userId: user.sub },
          })
          if (!destination) {
            results.push({ clientId: action.clientId, status: 'error', error: 'Cuenta destino no encontrada' })
            continue
          }
        }

        // ── Guard: liquidity (non-credit) accounts can't go negative ──────────
        // Mirrors the online POST /transactions guard so queued offline mutations
        // can't drive a debit/cash account below zero on replay.
        const outflowsFrom =
          destination ? account                              // transfer → origin
          : data.type === 'EXPENSE' ? account                // gasto → su cuenta
          : null
        if (outflowsFrom && outflowsFrom.type !== 'CREDIT' && data.notes !== 'MSI') {
          if (Number(data.amount) > Number(outflowsFrom.currentBalance ?? 0)) {
            results.push({ clientId: action.clientId, status: 'error', error: 'Saldo insuficiente' })
            continue
          }
        }

        const tx = await prisma.$transaction(async (prx) => {
          const created = await prx.transaction.create({
            data: {
              userId:            user.sub,
              accountId:         data.accountId,
              categoryId:        data.categoryId,
              type:              data.type,
              amount:            data.amount,
              description:       data.description,
              date:              new Date(data.date),
              notes:             data.notes,
              clientId:          action.clientId,
              transferAccountId: data.destinationAccountId,
              syncStatus:        'SYNCED',
            },
          })

          if (destination) {
            // Double-entry transfer / TDC payment: origin loses, destination
            // receives (a credit card's positive debt balance goes DOWN when paid).
            await prx.account.update({
              where: { id: data.accountId },
              data:  { currentBalance: { decrement: data.amount } },
            })
            await prx.account.update({
              where: { id: data.destinationAccountId },
              data:  destination.type === 'CREDIT'
                ? { currentBalance: { decrement: data.amount } }
                : { currentBalance: { increment: data.amount } },
            })
          } else if (data.notes !== 'MSI') {
            // Single-account movement. Credit cards store debt as a positive
            // balance, so a purchase (EXPENSE) raises it and a payment lowers it.
            const delta = account.type === 'CREDIT'
              ? (data.type === 'EXPENSE' ?  data.amount : -data.amount)
              : (data.type === 'INCOME'  ?  data.amount : -data.amount)
            await prx.account.update({
              where: { id: data.accountId },
              data:  { currentBalance: { increment: delta } },
            })
          }
          // MSI purchases (notes='MSI') don't move currentBalance — tracked separately.

          return created
        })
        results.push({ clientId: action.clientId, status: 'ok', data: tx })
      } else {
        results.push({ clientId: action.clientId, status: 'error', error: 'Acción no soportada' })
      }
    } catch (err: any) {
      results.push({ clientId: action.clientId, status: 'error', error: err.message })
    }
  }

  return NextResponse.json({ results })
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
