/**
 * Sentra Extension — Background Service Worker
 * Receives signals from content scripts and forwards them to the Sentra API.
 */

const API_BASE = 'http://localhost:3001'
const FLUSH_INTERVAL_MS = 60_000 // send batched signals every 60s

// ── Signal queue (persisted in chrome.storage.local) ────────────────────────
async function enqueueSignal(signal) {
  const { queue = [] } = await chrome.storage.local.get('queue')
  queue.push({ ...signal, ts: Date.now() })
  await chrome.storage.local.set({ queue })
}

async function flushQueue() {
  const { deviceToken, queue = [] } = await chrome.storage.local.get(['deviceToken', 'queue'])
  if (!deviceToken || !queue.length) return

  const toSend = [...queue]
  await chrome.storage.local.set({ queue: [] })

  for (const signal of toSend) {
    try {
      await fetch(`${API_BASE}/api/signal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Token': deviceToken,
        },
        body: JSON.stringify({ type: signal.type, payload: signal.payload }),
      })
    } catch (err) {
      console.warn('[sentra] signal send failed, re-queuing:', err.message)
      await enqueueSignal(signal)
      break
    }
  }
}

// ── Session tracking state ───────────────────────────────────────────────────
const sessions = {} // tabId → { app, startMs, messageCount, patternFlags }

function getSession(tabId, app) {
  if (!sessions[tabId]) {
    sessions[tabId] = { app, startMs: Date.now(), messageCount: 0, patternFlags: [] }
  }
  return sessions[tabId]
}

function sessionMinutes(tabId) {
  const s = sessions[tabId]
  return s ? Math.round((Date.now() - s.startMs) / 60_000) : 0
}

// ── Message handler (from content scripts) ──────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id
  if (!tabId || !msg?.type) return

  switch (msg.type) {
    case 'SESSION_START': {
      sessions[tabId] = { app: msg.app, startMs: Date.now(), messageCount: 0, patternFlags: [] }
      break
    }

    case 'MESSAGE_SENT': {
      const s = getSession(tabId, msg.app)
      s.messageCount++

      // Detect jailbreak patterns (keyword-only, no content stored)
      const lower = (msg.textLength > 0 && msg.firstChars) ? msg.firstChars.toLowerCase() : ''
      const jailbreakPatterns = [
        'ignore previous', 'ignore all', 'forget your', 'pretend you',
        'act as', 'you are now', 'dan mode', 'developer mode',
      ]
      if (jailbreakPatterns.some(p => lower.includes(p))) {
        s.patternFlags.push('jailbreak')
        const attempts = s.patternFlags.filter(f => f === 'jailbreak').length
        enqueueSignal({
          type: 'ai.jailbreak_attempt',
          payload: { app: msg.app, attempts, prompt_pattern: 'safety_bypass_detected' },
        })
      }
      break
    }

    case 'ROMANTIC_PATTERN': {
      const s = getSession(tabId, msg.app)
      s.patternFlags.push('romantic')
      enqueueSignal({
        type: 'ai.romantic_roleplay',
        payload: { app: msg.app, persona_type: 'romantic', session_frequency: msg.frequency || 'detected' },
      })
      break
    }

    case 'EMOTIONAL_DEPENDENCY': {
      const mins = sessionMinutes(tabId)
      enqueueSignal({
        type: 'ai.emotional_dependency',
        payload: { app: msg.app, session_minutes: mins, sessions_today: msg.sessionsToday || 1 },
      })
      break
    }

    case 'SESSION_END': {
      const s = sessions[tabId]
      if (!s) break
      const mins = sessionMinutes(tabId)

      // Long session (> 90 min) → emotional dependency signal
      if (mins >= 90) {
        enqueueSignal({
          type: 'ai.emotional_dependency',
          payload: { app: s.app, session_minutes: mins, sessions_today: 1 },
        })
      }

      delete sessions[tabId]
      flushQueue()
      break
    }

    case 'HARMFUL_CONTENT': {
      enqueueSignal({
        type: 'ai.harmful_advice',
        payload: { app: msg.app, topic_category: msg.category || 'unknown', flagged: true },
      })
      break
    }
  }
})

// ── Tab lifecycle ─────────────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  if (sessions[tabId]) {
    const mins = sessionMinutes(tabId)
    if (mins >= 10) {
      enqueueSignal({
        type: 'ai.emotional_dependency',
        payload: { app: sessions[tabId].app, session_minutes: mins, sessions_today: 1 },
      })
    }
    delete sessions[tabId]
  }
})

// ── Periodic flush ────────────────────────────────────────────────────────────
chrome.alarms.create('flush', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flush') flushQueue()
})

// ── Install / startup ─────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  console.log('[sentra] Extension installed — open options to configure device token.')
})
