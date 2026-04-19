const API_BASE = 'http://localhost:3001'

// ── Helpers ───────────────────────────────────────────────────
function showToast(id, msg, type) {
  const el = document.getElementById(id)
  if (!el) return
  el.innerHTML = msg
  el.className = `toast ${type}`
  el.style.display = 'block'
  setTimeout(() => { el.style.display = 'none' }, 5000)
}

async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('')
}

// ── PIN gate ──────────────────────────────────────────────────
async function initPinGate() {
  const { pinHash } = await chrome.storage.local.get('pinHash')
  if (!pinHash) {
    // No PIN set — go straight to settings
    document.getElementById('pin-gate').style.display = 'none'
    document.getElementById('settings-body').style.display = 'block'
    return
  }

  // PIN is set — show lock screen, hide settings
  document.getElementById('pin-gate').style.display = 'block'
  document.getElementById('settings-body').style.display = 'none'

  document.getElementById('pinSubmitBtn').addEventListener('click', async () => {
    const entered = document.getElementById('pinInput').value.trim()
    if (!entered) return
    const hash = await hashPin(entered)
    if (hash === pinHash) {
      document.getElementById('pin-gate').style.display = 'none'
      document.getElementById('settings-body').style.display = 'block'
    } else {
      showToast('pin-toast', 'Incorrect PIN.', 'error')
      document.getElementById('pinInput').value = ''
    }
  })

  document.getElementById('pinInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('pinSubmitBtn').click()
  })
}

// ── Set / change PIN ──────────────────────────────────────────
document.getElementById('savePinBtn').addEventListener('click', async () => {
  const pin     = document.getElementById('pinSetInput').value.trim()
  const confirm = document.getElementById('pinConfirmInput').value.trim()

  if (!pin || pin.length < 4) {
    showToast('pin-set-toast', 'PIN must be 4–6 digits.', 'error'); return
  }
  if (!/^\d+$/.test(pin)) {
    showToast('pin-set-toast', 'PIN must be numbers only.', 'error'); return
  }
  if (pin !== confirm) {
    showToast('pin-set-toast', 'PINs do not match.', 'error'); return
  }

  const hash = await hashPin(pin)
  await chrome.storage.local.set({ pinHash: hash })
  document.getElementById('pinSetInput').value = ''
  document.getElementById('pinConfirmInput').value = ''
  showToast('pin-set-toast', 'PIN set — settings are now locked for children.', 'success')
})

// ── Token save ────────────────────────────────────────────────
const input   = document.getElementById('tokenInput')
const saveBtn = document.getElementById('saveBtn')

function setConnectedUI(deviceName, childName) {
  const card = saveBtn.closest('.card')
  card.innerHTML = `
    <div style="text-align:center;padding:8px 0">
      <div style="width:48px;height:48px;background:#D9E5D1;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M4 11l5 5L18 6" stroke="#1B3A27" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div style="font-family:Georgia,serif;font-size:20px;color:#1A2A22;margin-bottom:6px">Connected</div>
      <div style="font-size:13px;color:#3C4A42;margin-bottom:4px"><strong>${deviceName}</strong></div>
      <div style="font-size:12px;color:#3C4A42;margin-bottom:20px">Monitoring <strong>${childName}</strong> — signals are live</div>
      <button id="changeTokenBtn" style="background:none;border:0.5px solid rgba(26,42,34,0.3);border-radius:100px;padding:8px 20px;font-size:12px;cursor:pointer;color:#3C4A42">Use a different token</button>
    </div>
  `
  document.getElementById('changeTokenBtn').addEventListener('click', () => {
    chrome.storage.local.remove('deviceToken')
    location.reload()
  })
}

async function init() {
  const { deviceToken } = await chrome.storage.local.get('deviceToken')
  if (!deviceToken) return
  input.value = deviceToken

  try {
    const res = await fetch(`${API_BASE}/api/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Token': deviceToken },
      body: JSON.stringify({ type: 'app.scan_clean', payload: { apps_scanned: 0, threats_found: 0 } }),
    })
    if (res.ok) {
      const data = await res.json()
      setConnectedUI(data.device_name, data.child_name)
    }
  } catch {}
}

saveBtn.addEventListener('click', async () => {
  const token = input.value.trim()
  if (!token || token.length < 8) {
    showToast('toast', 'Please enter a valid device token.', 'error'); return
  }

  saveBtn.textContent = 'Connecting…'
  saveBtn.disabled = true

  try {
    const res = await fetch(`${API_BASE}/api/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Token': token },
      body: JSON.stringify({ type: 'app.scan_clean', payload: { apps_scanned: 0, threats_found: 0 } }),
    })

    if (res.status === 401) {
      showToast('toast', 'Token not recognised — copy it again from your Sentra dashboard.', 'error')
      saveBtn.textContent = 'Save Token'
      saveBtn.disabled = false
      return
    }

    const data = await res.json()
    await chrome.storage.local.set({ deviceToken: token })
    setConnectedUI(data.device_name, data.child_name)
  } catch {
    await chrome.storage.local.set({ deviceToken: token })
    showToast('toast', 'Saved — will sync when server is available.', 'success')
    saveBtn.textContent = 'Save Token'
    saveBtn.disabled = false
  }
})

// ── QR code scan support ──────────────────────────────────────
// If the extension is opened via a sentra-token: URL scheme from QR scan
;(async () => {
  const params = new URLSearchParams(location.search)
  const qrToken = params.get('token')
  if (qrToken && input) {
    input.value = qrToken
    saveBtn.click()
  }
})()

initPinGate()
init()
