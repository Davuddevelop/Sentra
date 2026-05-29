const API_BASE   = 'https://sentra-peach-delta.vercel.app'
const STATUS_TTL = 30 * 1000

const MONITORED_APPS = ['ChatGPT', 'Claude', 'Gemini', 'Copilot', 'Character.AI', 'Replika']

async function getTodaySessions() {
  const today = new Date().toISOString().slice(0, 10)
  const keys  = MONITORED_APPS.map(a => `dailySessions_${a}`)
  const data  = await chrome.storage.local.get(keys)
  return MONITORED_APPS
    .map(app => ({ app, count: data[`dailySessions_${app}`]?.date === today ? data[`dailySessions_${app}`].count : 0 }))
    .filter(r => r.count > 0)
}

function makeRow(label, value) {
  const row = document.createElement('div')
  row.className = 'info-row'
  const lEl = document.createElement('div'); lEl.className = 'info-label'; lEl.textContent = label
  const vEl = document.createElement('div'); vEl.className = 'info-value';  vEl.textContent = value
  row.appendChild(lEl); row.appendChild(vEl)
  return row
}

function makeAppRow(app, count) {
  const row = document.createElement('div')
  row.className = 'app-row'
  const nameEl  = document.createElement('div'); nameEl.className = 'app-name';  nameEl.textContent = app
  const countEl = document.createElement('div'); countEl.className = 'app-count'; countEl.textContent = `${count} session${count !== 1 ? 's' : ''}`
  row.appendChild(nameEl); row.appendChild(countEl)
  return row
}

async function renderConnected(sec, dot, text, data) {
  dot.classList.remove('inactive')
  text.textContent = `Active — monitoring ${data.child_name}`

  sec.innerHTML = ''
  sec.appendChild(makeRow('Device', data.device_name))

  // Today's activity
  const sessions = await getTodaySessions()
  const actHeader = document.createElement('div')
  actHeader.className = 'section-label'
  actHeader.textContent = "Today's AI activity"
  sec.appendChild(actHeader)

  if (sessions.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'empty-activity'
    empty.textContent = 'No AI app sessions today'
    sec.appendChild(empty)
  } else {
    const grid = document.createElement('div')
    grid.className = 'app-grid'
    sessions.forEach(({ app, count }) => grid.appendChild(makeAppRow(app, count)))
    sec.appendChild(grid)
  }

  // Pending signals badge
  const { queue = [] } = await chrome.storage.local.get('queue')
  if (queue.length > 0) {
    const badge = document.createElement('div')
    badge.className = 'pending-badge'
    badge.textContent = `${queue.length} signal${queue.length !== 1 ? 's' : ''} pending upload`
    sec.appendChild(badge)
  }
}

async function init() {
  const { deviceToken } = await chrome.storage.local.get('deviceToken')
  const dot  = document.getElementById('statusDot')
  const text = document.getElementById('statusText')
  const sec  = document.getElementById('tokenSection')

  if (!deviceToken) {
    dot.classList.add('inactive')
    text.textContent = 'Not configured'
    sec.innerHTML = `<p class="no-token">Enter your device token in Settings to start monitoring.</p>`
    return
  }

  const { statusCache } = await chrome.storage.local.get('statusCache')
  if (statusCache?.ts && Date.now() - statusCache.ts < STATUS_TTL && statusCache.ok) {
    renderConnected(sec, dot, text, statusCache)
    return
  }

  try {
    const res = await fetch(`${API_BASE}/api/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Token': deviceToken },
      body: JSON.stringify({ type: 'app.scan_clean', payload: { apps_scanned: 0, threats_found: 0 } }),
    })

    if (res.ok) {
      const data = await res.json()
      await chrome.storage.local.set({ statusCache: { ...data, ok: true, ts: Date.now() } })
      renderConnected(sec, dot, text, data)
    } else {
      await chrome.storage.local.remove('statusCache')
      dot.classList.add('inactive')
      text.textContent = 'Token invalid — reconfigure'
      sec.innerHTML = `<p class="no-token">Token was rejected. Open Settings and re-enter it.</p>`
    }
  } catch {
    dot.classList.remove('inactive')
    text.textContent = 'Server offline — will retry'
    const masked = document.createElement('div')
    masked.className = 'info-row'
    const l = document.createElement('div'); l.className = 'info-label'; l.textContent = 'Token'
    const v = document.createElement('div'); v.className = 'info-value'; v.style.fontFamily = 'monospace'
    v.textContent = `••••••••••••••••••••••••••••${deviceToken.slice(-4)}`
    masked.appendChild(l); masked.appendChild(v)
    sec.appendChild(masked)
  }
}

init()
