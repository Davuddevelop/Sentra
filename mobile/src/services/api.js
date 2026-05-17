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
  let queue = []
  try { queue = raw ? JSON.parse(raw) : [] } catch { queue = [] }
  queue.push({ type, payload, ts: Date.now() })
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export async function flushSignals() {
  const token = await getToken()
  if (!token) return

  const raw = await AsyncStorage.getItem(QUEUE_KEY)
  if (!raw) return
  let queue = []
  try { queue = JSON.parse(raw) } catch { return }
  if (!queue.length) return

  // Send signals one at a time WITHOUT clearing the queue first.
  // Only remove each signal after it's confirmed sent, so a mid-flush
  // crash or network failure doesn't lose unsent signals.
  let sentCount = 0
  for (const signal of queue) {
    try {
      const res = await fetch(`${API_BASE}/api/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Token': token },
        body: JSON.stringify({ type: signal.type, payload: signal.payload }),
      })
      if (!res.ok) break
      sentCount++
    } catch {
      break
    }
  }

  if (sentCount > 0) {
    // Slice from the live queue so signals enqueued during flush are preserved.
    const live = await AsyncStorage.getItem(QUEUE_KEY)
    let liveQueue = []
    try { liveQueue = live ? JSON.parse(live) : [] } catch { liveQueue = [] }
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(liveQueue.slice(sentCount)))
  }
}
