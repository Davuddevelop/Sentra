const API_BASE = 'http://localhost:3001'

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
      sec.innerHTML = `
        <div class="device-row">
          <div class="device-label">Device</div>
          <div class="device-token" style="font-family:inherit;font-size:13px">${data.device_name}</div>
        </div>
        <div class="device-row" style="margin-top:6px">
          <div class="device-label">Monitoring</div>
          <div class="device-token" style="font-family:inherit;font-size:13px">${data.child_name}</div>
        </div>
      `
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
