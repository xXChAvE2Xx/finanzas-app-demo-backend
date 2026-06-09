import { NextRequest, NextResponse } from 'next/server'
import { verifyAccessToken, JwtPayload } from './jwt'

export type AuthenticatedRequest = NextRequest & { user: JwtPayload }

/**
 * Wraps a Next.js route handler with JWT authentication.
 * Reads the access token from the Authorization header: "Bearer <token>"
 * Returns 401 if the token is missing or invalid.
 */
export function withAuth(
  handler: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => Promise<NextResponse>
) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }): Promise<NextResponse> => {
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const token = authHeader.slice(7)
    try {
      const user = verifyAccessToken(token)
      return handler(req, ctx, user)
    } catch {
      return NextResponse.json({ error: 'Token inválido o expirado' }, { status: 401 })
    }
  }
}

/**
 * Enforces PREMIUM plan. Use after withAuth.
 */
export function requirePremium(user: JwtPayload): NextResponse | null {
  if (user.plan !== 'PREMIUM') {
    return NextResponse.json(
      { error: 'Esta funcionalidad requiere plan Premium', code: 'PREMIUM_REQUIRED' },
      { status: 403 }
    )
  }
  return null
}

/** Builds a Set-Cookie header value for the refresh token */
export function buildRefreshCookie(token: string, maxAgeSeconds: number): string {
  const isProduction = process.env.NODE_ENV === 'production'
  return [
    `refresh_token=${token}`,
    `Max-Age=${maxAgeSeconds}`,
    'Path=/api/auth',
    'HttpOnly',
    'SameSite=Strict',
    isProduction ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ')
}

/** Builds a cookie that clears the refresh token */
export function clearRefreshCookie(): string {
  return 'refresh_token=; Max-Age=0; Path=/api/auth; HttpOnly; SameSite=Strict'
}
