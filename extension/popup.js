const API_BASE = 'https://sentra-peach-delta.vercel.app'

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

  // Ping the server to confirm token is still valid + get device/child info
  try {
    const res = await fetch(`${API_BASE}/api/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Token': deviceToken },
      body: JSON.stringify({ type: 'app.scan_clean', payload: { apps_scanned: 0, threats_found: 0 } }),
    })

    if (res.ok) {
      const data = await res.json()
      dot.classList.remove('inactive')
      text.textContent = 'Active — monitoring AI apps'
      sec.innerHTML = ''
      const makeRow = (label, value) => {
        const row = document.createElement('div')
        row.className = 'device-row'
        row.style.marginTop = label === 'Monitoring' ? '6px' : '0'
        const lEl = document.createElement('div'); lEl.className = 'device-label'; lEl.textContent = label
        const vEl = document.createElement('div'); vEl.className = 'device-token'; vEl.style.cssText = 'font-family:inherit;font-size:13px'; vEl.textContent = value
        row.appendChild(lEl); row.appendChild(vEl)
        return row
      }
      sec.appendChild(makeRow('Device', data.device_name))
      sec.appendChild(makeRow('Monitoring', data.child_name))
    } else {
      dot.classList.add('inactive')
      text.textContent = 'Token invalid — reconfigure'
      sec.innerHTML = `<p class="no-token">Token was rejected. Open Settings and re-enter it.</p>`
    }
  } catch {
    // Server offline
    dot.classList.remove('inactive')
    text.textContent = 'Server offline — will retry'
    sec.innerHTML = `
      <div class="device-row">
        <div class="device-label">Token</div>
        <div class="device-token">${deviceToken.slice(0, 8)}••••••••${deviceToken.slice(-4)}</div>
      </div>
    `
  }
}

init()
