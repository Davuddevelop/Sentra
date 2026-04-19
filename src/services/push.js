/**
 * Expo Push Notification service.
 * Sends push notifications to parent devices via Expo's push API.
 * No APNs/FCM credentials needed in development — Expo handles the routing.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

export async function sendPushNotification({ pushToken, title, body, data = {} }) {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken')) return

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Accept':       'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to:    pushToken,
        title,
        body,
        data,
        sound: 'default',
        priority: 'high',
        channelId: 'sentra-alerts',
      }),
    })

    const result = await res.json()
    if (result?.data?.status === 'error') {
      console.error('[push] Expo push error:', result.data.message)
    }
  } catch (err) {
    console.error('[push] Failed to send notification:', err.message)
  }
}

export async function sendAlertPush({ pushToken, childName, level, title }) {
  const emoji = level === 'critical' ? '🚨' : '⚠️'
  await sendPushNotification({
    pushToken,
    title: `${emoji} Sentra alert for ${childName}`,
    body:  title,
    data:  { level, childName },
  })
}
