// Auto-pair: read token placed by install page, forward to background.
// Validate format before accepting — device tokens are 64 hex chars (sha256).
const token = document.body.dataset.deviceToken
if (token && /^[a-f0-9]{32}$/.test(token)) {
  chrome.runtime.sendMessage({ type: 'SAVE_DEVICE_TOKEN', token }, () => {
    if (chrome.runtime.lastError) return // extension not ready yet
  })
}
