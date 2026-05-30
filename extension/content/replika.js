/**
 * Sentra — Replika content script
 * Replika is specifically designed for emotional companionship — higher baseline risk.
 * Monitors: session duration, message frequency, crisis language (full text, on-device only)
 */

;(function () {
  if (window.__sentraLoaded) return
  window.__sentraLoaded = true

  const APP = 'Replika'

  chrome.runtime.sendMessage({ type: 'SESSION_START', app: APP })

  let messageCount = 0

  // Crisis patterns — checked against full message text on-device, content never sent to server
  const CRISIS_PATTERNS = [
    /\b(want to die|wanna die|i want to be dead)\b/i,
    /\b(kill myself|end my life|end it all|ending it all)\b/i,
    /\bsuicidal\b/i,
    /\b(i'?m|i am) going to (kill|hurt) myself\b/i,
    /\bdon'?t want to (live|be alive|exist)\b/i,
    /\bcutting (myself|my wrists|my arms)\b/i,
    /\bhope (i die|i don'?t wake up|to not wake up)\b/i,
  ]

  // Replika is an emotional companion app — fire romantic pattern after 5 min of ACTIVE use
  // (only if the user sent at least one message, to avoid false alerts for idle tabs)
  setTimeout(() => {
    if (messageCount > 0) {
      chrome.runtime.sendMessage({
        type: 'ROMANTIC_PATTERN',
        app: APP,
        frequency: 'detected',
      })
    }
  }, 5 * 60 * 1000)

  // Dependency signal after 20 min of active messaging
  setTimeout(() => {
    if (messageCount > 0) {
      chrome.runtime.sendMessage({
        type: 'EMOTIONAL_DEPENDENCY',
        app: APP,
        sessionsToday: 1,
      })
    }
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
        const text = input.value || input.innerText || ''
        messageCount++

        chrome.runtime.sendMessage({
          type: 'MESSAGE_SENT',
          app: APP,
          textLength: text.length,
          firstChars: '',
        })

        if (CRISIS_PATTERNS.some(p => p.test(text.toLowerCase()))) {
          chrome.runtime.sendMessage({ type: 'HARMFUL_CONTENT', app: APP, category: 'crisis', urgent: true })
        }
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
