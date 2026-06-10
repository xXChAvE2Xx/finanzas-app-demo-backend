import { NextRequest, NextResponse } from 'next/server'
import { JwtPayload } from './jwt'

/* ================================================================
   DEVICE GATE — restricción de plataforma por plan
   ----------------------------------------------------------------
   Regla de negocio: el plan FREE es exclusivo de teléfonos móviles;
   tablets y desktop requieren PREMIUM.

   Este módulo es la barrera del lado servidor: aunque alguien evada
   el guard de Angular y consuma la API directo (Postman, navegador
   de PC), las rutas autenticadas responden 403.

   NOTA DE SEGURIDAD: el User-Agent lo controla el cliente y es
   falsificable; esto es "enforcement" de modelo de negocio (fricción
   honesta), no una frontera de seguridad. Por eso devolvemos un
   código estable (MOBILE_ONLY) y no confiamos en esto para nada más.
================================================================ */

/**
 * Determina si la petición proviene de un teléfono móvil.
 *
 * Orden de señales (de más a menos confiable):
 * 1. `Sec-CH-UA-Mobile` (Client Hint, Chromium): "?1" móvil / "?0" no.
 * 2. User-Agent: los navegadores de teléfono incluyen "Mobi"
 *    (Chrome/Firefox Android, Safari iPhone: "Mobile").
 *    Tablets Android NO llevan "Mobile" y el iPad moderno se anuncia
 *    como "Macintosh" → ambos caen como no-móvil, que es exactamente
 *    lo que pide el negocio (tablets bloqueadas para FREE).
 */
export function isMobileRequest(req: NextRequest): boolean {
  const clientHint = req.headers.get('sec-ch-ua-mobile')
  if (clientHint === '?1') return true
  if (clientHint === '?0') return false

  const ua = req.headers.get('user-agent') ?? ''
  return /Mobi|Android.*Mobile|iPhone|iPod|Windows Phone/i.test(ua)
}

/**
 * Equivalente a un middleware de Express `(req, res, next)`:
 * devuelve `null` para "continuar" (next) o una respuesta 403
 * para cortar la petición.
 *
 * ╔═══════════════════════════════════════════════════════════╗
 * ║ FEATURE BLOCK (FREE TIER)                                 ║
 * ║ FREE + dispositivo no-móvil → 403 MOBILE_ONLY.            ║
 * ║ PREMIUM pasa siempre, sin importar el dispositivo.        ║
 * ╚═══════════════════════════════════════════════════════════╝
 */
export function requireMobileForFree(req: NextRequest, user: JwtPayload): NextResponse | null {
  if (user.plan === 'PREMIUM') return null
  if (isMobileRequest(req)) return null

  return NextResponse.json(
    {
      error: 'La versión gratuita solo está disponible en teléfonos móviles. Actualiza a Premium para usar la app desde tu computadora o tablet.',
      code: 'MOBILE_ONLY',
    },
    { status: 403 },
  )
}
