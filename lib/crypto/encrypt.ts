import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LEN = 32
const IV_LEN = 16
const TAG_LEN = 16

function deriveKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY!
  // Use a fixed salt here so the key is deterministic per deployment.
  // In production, store the salt alongside each encrypted value if you need per-record keys.
  return scryptSync(secret, 'finanzas-salt', KEY_LEN) as Buffer
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a base64 string: iv:authTag:ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = deriveKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
}

/**
 * Decrypts a base64 string produced by `encrypt`.
 */
export function decrypt(ciphertext: string): string {
  const [ivB64, tagB64, dataB64] = ciphertext.split(':')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid ciphertext format')

  const key = deriveKey()
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(tagB64, 'base64')
  const data = Buffer.from(dataB64, 'base64')

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(data).toString('utf8') + decipher.final('utf8')
}

/** Convenience: encrypt only the last 4 digits of a card number */
export function encryptLastFour(digits: string): string {
  if (!/^\d{4}$/.test(digits)) throw new Error('lastFourDigits must be exactly 4 digits')
  return encrypt(digits)
}

export function decryptLastFour(ciphertext: string): string {
  return decrypt(ciphertext)
}
