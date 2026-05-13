import AsyncStorage from '@react-native-async-storage/async-storage'

const API_BASE = 'https://sentra-peach-delta.vercel.app'

export async function getToken() {
  return AsyncStorage.getItem('deviceToken')
}

export async function saveToken(token) {
  await AsyncStorage.setItem('deviceToken', token)
}

export async function clearToken() {
  await AsyncStorage.removeItem('deviceToken')
}

// Verify token against the API — returns { device_name, child_name } on success
export async function verifyToken(token) {
  const res = await fetch(`${API_BASE}/api/signal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Token': token },
    body: JSON.stringify({ type: 'app.scan_clean', payload: { apps_scanned: 0, threats_found: 0 } }),
  })
  if (!res.ok) throw new Error('Token not recognised')
  return res.json()
}

// Queue signals locally then flush in batch
const QUEUE_KEY = 'signalQueue'

export async function enqueueSignal(type, payload) {
  const raw = await AsyncStorage.getItem(QUEUE_KEY)
  const queue = raw ? JSON.parse(raw) : []
  queue.push({ type, payload, ts: Date.now() })
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export async function flushSignals() {
  const token = await getToken()
  if (!token) return

  const raw = await AsyncStorage.getItem(QUEUE_KEY)
  if (!raw) return
  const queue = JSON.parse(raw)
  if (!queue.length) return

  await AsyncStorage.setItem(QUEUE_KEY, '[]')

  for (const signal of queue) {
    try {
      await fetch(`${API_BASE}/api/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Token': token },
        body: JSON.stringify({ type: signal.type, payload: signal.payload }),
      })
    } catch {
      // Re-queue failed signals
      await enqueueSignal(signal.type, signal.payload)
      break
    }
  }
}
