import { NextRequest, NextResponse } from 'next/server'
import { verifyAccessToken, JwtPayload } from './jwt'
import { requireMobileForFree } from './device'

export type AuthenticatedRequest = NextRequest & { user: JwtPayload }

/**
 * Wraps a Next.js route handler with JWT authentication.
 * Reads the access token from the Authorization header: "Bearer <token>"
 * Returns 401 if the token is missing or invalid.
 *
 * También aplica la restricción de plataforma: tras validar el JWT,
 * un usuario FREE en dispositivo no-móvil recibe 403 MOBILE_ONLY
 * (ver lib/auth/device.ts). Esto cubre TODAS las rutas de datos;
 * las rutas de /auth no usan withAuth, de modo que login/refresh
 * siguen funcionando desde desktop (necesario para que un usuario
 * pueda autenticarse y contratar Premium).
 */
export interface WithAuthOptions {
  /**
   * Exime la ruta del bloqueo móvil-only para usuarios FREE.
   * Solo debe usarse en rutas de identidad/upgrade (p. ej. /auth/me):
   * el usuario necesita saber quién es y poder contratar Premium
   * desde desktop, aunque no pueda consumir datos.
   */
  skipDeviceGate?: boolean
}

export function withAuth(
  handler: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }, user: JwtPayload) => Promise<NextResponse>,
  options: WithAuthOptions = {}
) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }): Promise<NextResponse> => {
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const token = authHeader.slice(7)
    try {
      const user = verifyAccessToken(token)

      // ── FEATURE BLOCK (FREE TIER): móvil-only ──────────────
      if (!options.skipDeviceGate) {
        const deviceBlock = requireMobileForFree(req, user)
        if (deviceBlock) return deviceBlock
      }

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
