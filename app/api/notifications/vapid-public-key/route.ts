import { NextResponse } from 'next/server'

/** Public endpoint — no auth needed.
 *  The SW fetches this to subscribe to push.
 */
export function GET() {
  const key = process.env.VAPID_PUBLIC_KEY
  if (!key) {
    return NextResponse.json({ error: 'VAPID key not configured' }, { status: 503 })
  }
  return NextResponse.json({ key })
}

export async function OPTIONS() { return new NextResponse(null, { status: 204 }) }
