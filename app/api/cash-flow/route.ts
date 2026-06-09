import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { calcCashFlow } from '@/lib/cash-flow/calculator'
import type { JwtPayload } from '@/lib/auth/jwt'

export const GET = withAuth(async (_req: NextRequest, _ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => {
  const result = await calcCashFlow(user.sub)
  return NextResponse.json(result)
})

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
