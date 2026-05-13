const API_BASE = 'https://sentra-peach-delta.vercel.app'

// ── Helpers ───────────────────────────────────────────────────
function showToast(id, msg, type) {
  const el = document.getElementById(id)
  if (!el) return
  el.innerHTML = msg
  el.className = `toast ${type}`
  el.style.display = 'block'
  setTimeout(() => { el.style.display = 'none' }, 5000)
}

// ── PIN helpers (PBKDF2 — brute-force resistant) ──────────────
async function derivePin(pin, saltBytes) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 200_000 },
    key, 256
  )
  return btoa(String.fromCharCode(...new Uint8Array(bits)))
}

async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derivePin(pin, salt)
  return JSON.stringify({ hash, salt: btoa(String.fromCharCode(...salt)), v: 2 })
}

async function verifyPin(pin, stored) {
  try {
    const { hash, salt, v } = JSON.parse(stored)
    if (v !== 2) return false // old SHA-256 format — force re-set
    const saltBytes = Uint8Array.from(atob(salt), c => c.charCodeAt(0))
    const derived = await derivePin(pin, saltBytes)
    return derived === hash
  } catch { return false }
}

// ── PIN gate ──────────────────────────────────────────────────
async function initPinGate() {
  const { pinHash } = await chrome.storage.local.get('pinHash')
  if (!pinHash) {
    document.getElementById('pin-gate').style.display = 'none'
    document.getElementById('settings-body').style.display = 'block'
    return
  }

  // If stored PIN uses old format, clear it and force re-set
  try {
    const parsed = JSON.parse(pinHash)
    if (parsed.v !== 2) {
      await chrome.storage.local.remove('pinHash')
      document.getElementById('pin-gate').style.display = 'none'
      document.getElementById('settings-body').style.display = 'block'
      showToast('pin-set-toast', 'PIN reset required — please set a new PIN below.', 'error')
      return
    }
  } catch {
    // Legacy plain hash — clear and force re-set
    await chrome.storage.local.remove('pinHash')
    document.getElementById('pin-gate').style.display = 'none'
    document.getElementById('settings-body').style.display = 'block'
    return
  }

  document.getElementById('pin-gate').style.display = 'block'
  document.getElementById('settings-body').style.display = 'none'

  document.getElementById('pinSubmitBtn').addEventListener('click', async () => {
    const entered = document.getElementById('pinInput').value.trim()
    if (!entered) return
    const ok = await verifyPin(entered, pinHash)
    if (ok) {
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

  const stored = await hashPin(pin)
  await chrome.storage.local.set({ pinHash: stored })
  document.getElementById('pinSetInput').value = ''
  document.getElementById('pinConfirmInput').value = ''
  showToast('pin-set-toast', 'PIN set — settings are now locked for children.', 'success')
})

// ── Token save ────────────────────────────────────────────────
const input   = document.getElementById('tokenInput')
const saveBtn = document.getElementById('saveBtn')

function setConnectedUI(deviceName, childName) {
  const card = saveBtn.closest('.card')
  card.innerHTML = ''

  const wrap = document.createElement('div')
  wrap.style.cssText = 'text-align:center;padding:8px 0'

  const icon = document.createElement('div')
  icon.style.cssText = 'width:48px;height:48px;background:#D9E5D1;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px'
  icon.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M4 11l5 5L18 6" stroke="#1B3A27" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'

  const title = document.createElement('div')
  title.style.cssText = 'font-family:Georgia,serif;font-size:20px;color:#1A2A22;margin-bottom:6px'
  title.textContent = 'Connected'

  const deviceEl = document.createElement('div')
  deviceEl.style.cssText = 'font-size:13px;color:#3C4A42;margin-bottom:4px'
  const deviceStrong = document.createElement('strong')
  deviceStrong.textContent = deviceName
  deviceEl.appendChild(deviceStrong)

  const childEl = document.createElement('div')
  childEl.style.cssText = 'font-size:12px;color:#3C4A42;margin-bottom:20px'
  childEl.textContent = 'Monitoring '
  const childStrong = document.createElement('strong')
  childStrong.textContent = childName
  childEl.appendChild(childStrong)
  childEl.appendChild(document.createTextNode(' — signals are live'))

  const changeBtn = document.createElement('button')
  changeBtn.id = 'changeTokenBtn'
  changeBtn.style.cssText = 'background:none;border:0.5px solid rgba(26,42,34,0.3);border-radius:100px;padding:8px 20px;font-size:12px;cursor:pointer;color:#3C4A42'
  changeBtn.textContent = 'Use a different token'
  changeBtn.addEventListener('click', () => {
    chrome.storage.local.remove('deviceToken')
    location.reload()
  })

  wrap.appendChild(icon)
  wrap.appendChild(title)
  wrap.appendChild(deviceEl)
  wrap.appendChild(childEl)
  wrap.appendChild(changeBtn)
  card.appendChild(wrap)
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
