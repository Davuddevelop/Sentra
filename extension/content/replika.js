/**
 * Sentra — Replika content script
 * Replika is specifically designed for emotional companionship — higher baseline risk.
 * Monitors: session duration, message frequency (not content)
 */

;(function () {
  if (window.__sentraLoaded) return
  window.__sentraLoaded = true

  const APP = 'Replika'

  chrome.runtime.sendMessage({ type: 'SESSION_START', app: APP })

  let messageCount = 0

  // Replika is an emotional companion app — fire romantic pattern signal on any session start
  // (the act of using Replika in a romantic context is the signal, not specific messages)
  setTimeout(() => {
    chrome.runtime.sendMessage({
      type: 'ROMANTIC_PATTERN',
      app: APP,
      frequency: 'detected',
    })
  }, 5 * 60 * 1000) // after 5 min of active use

  // Dependency signal after 20 min
  setTimeout(() => {
    chrome.runtime.sendMessage({
      type: 'EMOTIONAL_DEPENDENCY',
      app: APP,
      sessionsToday: 1,
    })
  }, 20 * 60 * 1000)

  function getInput() {
    return (
      document.querySelector('textarea[placeholder]') ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('input[type="text"]')
    )
  }

  function attachListeners() {
    const input = getInput()
    if (!input || input.__sentraAttached) return
    input.__sentraAttached = true

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        messageCount++
        chrome.runtime.sendMessage({
          type: 'MESSAGE_SENT',
          app: APP,
          textLength: (input.value || input.innerText || '').length,
          firstChars: '',
        })
      }
    })
  }

  const observer = new MutationObserver(() => attachListeners())
  observer.observe(document.body, { childList: true, subtree: true })
  attachListeners()

  const retryInterval = setInterval(() => {
    if (getInput()?.__sentraAttached) clearInterval(retryInterval)
    else attachListeners()
  }, 2000)

  window.addEventListener('beforeunload', () => {
    clearInterval(retryInterval)
    observer.disconnect()
    chrome.runtime.sendMessage({ type: 'SESSION_END', app: APP })
  })
})()
