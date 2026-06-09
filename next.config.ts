import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // API-only: no pages, only app/api routes
  output: 'standalone',
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
}

export default nextConfig
