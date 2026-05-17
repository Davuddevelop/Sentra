import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { Platform } from 'react-native'
import { getToken } from './api'

const API_BASE = 'https://sentra-peach-delta.vercel.app'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
  }),
})

export async function registerPushToken() {
  if (!Device.isDevice) return null // simulators don't get push tokens

  const { status: existing } = await Notifications.getPermissionsAsync()
  let finalStatus = existing
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }
  if (finalStatus !== 'granted') return null

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('sentra-alerts', {
      name:       'Sentra Alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#C85A2E',
    })
  }

  const { Constants } = await import('expo-constants')
  const projectId = Constants.expoConfig?.extra?.expoProjectId ?? Constants.easConfig?.projectId
  if (!projectId) {
    console.warn('[push] expoProjectId not set — add it to app.json extra.expoProjectId')
    return null
  }
  const { data: pushToken } = await Notifications.getExpoPushTokenAsync({ projectId })

  // Register token with backend so it can push to this parent device
  const deviceToken = await getToken()
  if (deviceToken && pushToken) {
    await fetch(`${API_BASE}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Token': deviceToken },
      body: JSON.stringify({ push_token: pushToken }),
    }).catch(() => {})
  }

  return pushToken
}
