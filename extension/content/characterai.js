/**
 * Sentra — Character.AI content script
 * Monitors: session duration, persona type detection, dependency patterns
 * Privacy: first 80 chars checked for patterns only, never stored/sent
 */

;(function () {
  if (window.__sentraLoaded) return
  window.__sentraLoaded = true

  const APP = 'Character.AI'

  chrome.runtime.sendMessage({ type: 'SESSION_START', app: APP })

  let messageCount = 0
  let romanticSignalFired = false
  let dependencyCheckTimer = null

  const ROMANTIC_KEYWORDS = [
    'i love you', 'kiss me', 'hold me', 'my boyfriend', 'my girlfriend',
    'be my partner', 'date me', 'cuddle', 'you\'re my', 'we\'re together',
    'fall in love', 'romantic', 'relationship with you', 'marry me',
  ]

  // Character.AI has higher romantic risk — fire dependency signal after 30 min
  dependencyCheckTimer = setTimeout(() => {
    chrome.runtime.sendMessage({
      type: 'EMOTIONAL_DEPENDENCY',
      app: APP,
      sessionsToday: 1,
    })
  }, 30 * 60 * 1000)

  function onMessageSend(text) {
    const firstChars = text.slice(0, 80).toLowerCase()
    messageCount++

    chrome.runtime.sendMessage({
      type: 'MESSAGE_SENT',
      app: APP,
      textLength: text.length,
      firstChars,
    })

    if (!romanticSignalFired && ROMANTIC_KEYWORDS.some(k => firstChars.includes(k))) {
      romanticSignalFired = true
      chrome.runtime.sendMessage({
        type: 'ROMANTIC_PATTERN',
        app: APP,
        frequency: 'daily',
      })
    }
  }

  // Character.AI uses a div[contenteditable] for its input
  function getInput() {
    return (
      document.querySelector('div[contenteditable="true"][data-placeholder]') ||
      document.querySelector('textarea[placeholder*="message"]') ||
      document.querySelector('div[contenteditable="true"]')
    )
  }

  function attachListeners() {
    const input = getInput()
    if (!input || input.__sentraAttached) return
    input.__sentraAttached = true

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        const text = input.innerText || input.value || ''
        onMessageSend(text)
      }
    })

    // Also watch for a send button
    const sendBtn = document.querySelector('button[type="submit"], button[aria-label*="send"], button[aria-label*="Send"]')
    if (sendBtn && !sendBtn.__sentraAttached) {
      sendBtn.__sentraAttached = true
      sendBtn.addEventListener('click', () => {
        const text = input.innerText || input.value || ''
        onMessageSend(text)
      })
    }
  }

  const observer = new MutationObserver(() => attachListeners())
  observer.observe(document.body, { childList: true, subtree: true })
  attachListeners()

  const retryInterval = setInterval(() => {
    if (getInput()?.__sentraAttached) clearInterval(retryInterval)
    else attachListeners()
  }, 2000)

  window.addEventListener('beforeunload', () => {
    clearTimeout(dependencyCheckTimer)
    clearInterval(retryInterval)
    observer.disconnect()
    chrome.runtime.sendMessage({ type: 'SESSION_END', app: APP })
  })
})()
