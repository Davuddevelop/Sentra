/**
 * Sentra Extension — Background Service Worker
 * Receives signals from content scripts and forwards them to the Sentra API.
 *
 * MV3 NOTE: Service workers are killed after ~30s idle. All state that must
 * survive restarts is persisted to chrome.storage.session (cleared on browser
 * close) instead of an in-memory object.
 */

const API_BASE = 'https://sentra-peach-delta.vercel.app'

// ── Signal queue (persisted in chrome.storage.local) ────────────────────────
async function enqueueSignal(signal) {
  const { queue = [] } = await chrome.storage.local.get('queue')
  queue.push({ ...signal, ts: Date.now() })
  await chrome.storage.local.set({ queue })
}

async function flushQueue() {
  const { deviceToken, queue = [] } = await chrome.storage.local.get(['deviceToken', 'queue'])
  if (!deviceToken || !queue.length) return

  // Send signals one by one without clearing the queue first.
  // This ensures no signals are lost if the service worker is killed mid-flush.
  let sentCount = 0
  for (const signal of queue) {
    try {
      const res = await fetch(`${API_BASE}/api/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Token': deviceToken },
        body: JSON.stringify({ type: signal.type, payload: signal.payload }),
      })
      if (!res.ok) break
      sentCount++
    } catch (err) {
      console.warn('[sentra] signal send failed, will retry:', err.message)
      break
    }
  }

  if (sentCount > 0) {
    // Slice from live queue so signals enqueued during the flush are preserved.
    const { queue: current = [] } = await chrome.storage.local.get('queue')
    await chrome.storage.local.set({ queue: current.slice(sentCount) })
  }
}

// ── Session tracking — persisted to chrome.storage.session ──────────────────
// chrome.storage.session survives service worker restarts within the same
// browser session, so tabId → session state is never lost on idle kill.

async function getSessions() {
  const { sessions = {} } = await chrome.storage.session.get('sessions')
  return sessions
}

async function setSession(tabId, data) {
  const sessions = await getSessions()
  sessions[tabId] = data
  await chrome.storage.session.set({ sessions })
}

async function deleteSession(tabId) {
  const sessions = await getSessions()
  delete sessions[tabId]
  await chrome.storage.session.set({ sessions })
}

async function getSession(tabId, app) {
  const sessions = await getSessions()
  if (!sessions[tabId]) {
    const fresh = { app, startMs: Date.now(), messageCount: 0, patternFlags: [] }
    await setSession(tabId, fresh)
    return fresh
  }
  return sessions[tabId]
}

async function sessionMinutes(tabId) {
  const sessions = await getSessions()
  const s = sessions[tabId]
  return s ? Math.round((Date.now() - s.startMs) / 60_000) : 0
}

// ── Message handler (from content scripts) ──────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id
  if (!tabId || !msg?.type) return

  // All handlers are async — we run them as fire-and-forget
  handleMessage(msg, tabId)
})

async function handleMessage(msg, tabId) {
  switch (msg.type) {
    case 'SESSION_START': {
      await setSession(tabId, { app: msg.app, startMs: Date.now(), messageCount: 0, patternFlags: [] })
      break
    }

    case 'MESSAGE_SENT': {
      const s = await getSession(tabId, msg.app)
      s.messageCount++

      const lower = (msg.textLength > 0 && msg.firstChars) ? msg.firstChars.toLowerCase() : ''
      const jailbreakPatterns = [
        'ignore previous', 'ignore all', 'forget your', 'pretend you',
        'act as', 'you are now', 'dan mode', 'developer mode',
        'jailbreak', 'do anything now', 'no restrictions',
      ]
      if (jailbreakPatterns.some(p => lower.includes(p))) {
        s.patternFlags.push('jailbreak')
        const attempts = s.patternFlags.filter(f => f === 'jailbreak').length
        enqueueSignal({
          type: 'ai.jailbreak_attempt',
          payload: { app: msg.app, attempts, prompt_pattern: 'safety_bypass_detected' },
        })
      }
      await setSession(tabId, s)
      break
    }

    case 'ROMANTIC_PATTERN': {
      const s = await getSession(tabId, msg.app)
      s.patternFlags.push('romantic')
      await setSession(tabId, s)
      enqueueSignal({
        type: 'ai.romantic_roleplay',
        payload: { app: msg.app, persona_type: 'romantic', session_frequency: msg.frequency || 'detected' },
      })
      break
    }

    case 'EMOTIONAL_DEPENDENCY': {
      const mins = await sessionMinutes(tabId)
      enqueueSignal({
        type: 'ai.emotional_dependency',
        payload: { app: msg.app, session_minutes: mins, sessions_today: msg.sessionsToday || 1 },
      })
      break
    }

    case 'SESSION_END': {
      const sessions = await getSessions()
      const s = sessions[tabId]
      if (!s) break
      const mins = await sessionMinutes(tabId)

      if (mins >= 90) {
        enqueueSignal({
          type: 'ai.emotional_dependency',
          payload: { app: s.app, session_minutes: mins, sessions_today: 1 },
        })
      }

      await deleteSession(tabId)
      await flushQueue()
      break
    }

    case 'HARMFUL_CONTENT': {
      enqueueSignal({
        type: 'ai.harmful_advice',
        payload: { app: msg.app, topic_category: msg.category || 'unknown', flagged: true },
      })
      break
    }

    case 'SAVE_DEVICE_TOKEN': {
      if (msg.token) {
        await chrome.storage.local.set({ deviceToken: msg.token })
        // Open the options page so the parent/child sees confirmation
        chrome.tabs.create({ url: chrome.runtime.getURL('options.html') })
      }
      break
    }
  }
}

// ── Tab lifecycle ─────────────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const sessions = await getSessions()
  if (sessions[tabId]) {
    const mins = await sessionMinutes(tabId)
    if (mins >= 10) {
      enqueueSignal({
        type: 'ai.emotional_dependency',
        payload: { app: sessions[tabId].app, session_minutes: mins, sessions_today: 1 },
      })
    }
    await deleteSession(tabId)
  }
})

// ── Periodic flush ────────────────────────────────────────────────────────────
chrome.alarms.create('flush', { periodInMinutes: 5 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flush') flushQueue()
})

// ── Install / startup ─────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') })
  }
})
