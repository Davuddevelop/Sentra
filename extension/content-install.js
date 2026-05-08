// Auto-pair: read token placed by install page, forward to background
const token = document.body.dataset.deviceToken
if (token) {
  chrome.runtime.sendMessage({ type: 'SAVE_DEVICE_TOKEN', token }, () => {
    if (chrome.runtime.lastError) return // extension not ready yet
  })
}
