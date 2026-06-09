import { NextRequest, NextResponse } from 'next/server'

const allowedOrigins = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:4200',
  'http://localhost:3000',
  'https://corruptibly-doctrinal-verline.ngrok-free.dev',
].filter(Boolean) as string[]

export function middleware(req: NextRequest) {
  const origin = req.headers.get('origin') ?? ''
  const isAllowed = allowedOrigins.includes(origin)

  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    const res = new NextResponse(null, { status: 204 })
    if (isAllowed) {
      res.headers.set('Access-Control-Allow-Origin', origin)
    }
    res.headers.set('Access-Control-Allow-Credentials', 'true')
    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.headers.set('Access-Control-Max-Age', '86400')
    return res
  }

  // For all other requests, add CORS headers to the response
  const res = NextResponse.next()
  if (isAllowed) {
    res.headers.set('Access-Control-Allow-Origin', origin)
  }
  res.headers.set('Access-Control-Allow-Credentials', 'true')
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  return res
}

export const config = {
  matcher: '/api/:path*',
}
