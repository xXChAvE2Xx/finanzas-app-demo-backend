import webpush from 'web-push'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'

let _initialized = false

function init() {
  if (_initialized) return
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@finanzas.app'
  if (pub && priv) {
    webpush.setVapidDetails(subject, pub, priv)
    _initialized = true
  }
}

export interface PushPayload {
  title: string
  body: string
  icon?: string
  data?: Record<string, unknown>
}

/**
 * Sends a Web Push notification to all active subscriptions of a user.
 * Silently removes invalid/expired subscriptions (410 Gone).
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  init()
  if (!_initialized) return // VAPID keys not configured — skip silently

  const subs = await prisma.pushSubscription.findMany({ where: { userId } })

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ notification: payload })
        )
      } catch (err: any) {
        // 410 Gone = subscription no longer valid → remove it
        if (err?.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
        }
      }
    })
  )
}

/**
 * Also saves an in-app Notification record alongside the push.
 */
export async function notifyUser(
  userId: string,
  type: string,
  payload: PushPayload,
  data?: Record<string, unknown>
): Promise<void> {
  await Promise.allSettled([
    sendPushToUser(userId, payload),
    prisma.notification.create({
      data: {
        userId,
        type: type as any,
        title: payload.title,
        body: payload.body,
        data: (data as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
    }),
  ])
}
