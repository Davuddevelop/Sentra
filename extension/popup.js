const API_BASE    = 'https://sentra-peach-delta.vercel.app'
const STATUS_TTL  = 30 * 1000 // re-verify at most every 30 seconds

function makeRow(label, value) {
  const row = document.createElement('div')
  row.className = 'device-row'
  row.style.marginTop = label === 'Monitoring' ? '6px' : '0'
  const lEl = document.createElement('div'); lEl.className = 'device-label'; lEl.textContent = label
  const vEl = document.createElement('div'); vEl.className = 'device-token'; vEl.style.cssText = 'font-family:inherit;font-size:13px'; vEl.textContent = value
  row.appendChild(lEl); row.appendChild(vEl)
  return row
}

function renderConnected(sec, dot, text, data) {
  dot.classList.remove('inactive')
  text.textContent = 'Active — monitoring AI apps'
  sec.innerHTML = ''
  sec.appendChild(makeRow('Device', data.device_name))
  sec.appendChild(makeRow('Monitoring', data.child_name))
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

  // Show cached status immediately so the popup feels instant
  const { statusCache } = await chrome.storage.local.get('statusCache')
  if (statusCache?.ts && Date.now() - statusCache.ts < STATUS_TTL && statusCache.ok) {
    renderConnected(sec, dot, text, statusCache)
    return
  }

  // Cache expired or missing — verify against server
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
    // Server unreachable — show masked token, don't mark as inactive
    dot.classList.remove('inactive')
    text.textContent = 'Server offline — will retry'
    sec.innerHTML = `
      <div class="device-row">
        <div class="device-label">Token</div>
        <div class="device-token">••••••••••••••••••••••••••••${deviceToken.slice(-4)}</div>
      </div>
    `
  }
}

init()
