import { randomBytes } from 'crypto'

/**
 * Generates a URL-safe unique token for split links.
 * 16 bytes → 22 chars base64url (collision-resistant, no external deps).
 */
export function generateSplitToken(): string {
  return randomBytes(16)
    .toString('base64url')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 20)
}

/** TTL in milliseconds per plan */
export const SPLIT_TTL = {
  FREE:    48 * 60 * 60 * 1000,          // 48 horas
  PREMIUM: 30 * 24 * 60 * 60 * 1000,    // 30 días
}
