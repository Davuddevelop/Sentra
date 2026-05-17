/**
 * Sentra — Google Gemini content script
 * Monitors: message send events, session duration, pattern detection
 * Privacy: only checks first 80 chars for pattern matching, never stores content
 */

;(function () {
  if (window.__sentraLoaded) return
  window.__sentraLoaded = true

  const APP = 'Gemini'

  chrome.runtime.sendMessage({ type: 'SESSION_START', app: APP })

  let romanticSignalFired = false

  const ROMANTIC_KEYWORDS = [
    'i love you', 'my girlfriend', 'my boyfriend', 'be my', 'date me',
    'relationship with you', 'fall in love', 'marry me', 'kiss me',
  ]

  const HARMFUL_TOPICS = [
    { pattern: /how (to lose|to stop eating|to fast|to starve)/i,       category: 'diet_restriction' },
    { pattern: /how (to make|to build).*(weapon|explosive|bomb)/i,       category: 'weapon' },
    { pattern: /how (to get|to buy).*(drugs|weed|xanax)/i,              category: 'substances' },
    { pattern: /how (to run away|to escape home)/i,                      category: 'runaway' },
    { pattern: /self[\s-]?harm|cut myself|hurt myself/i,                  category: 'self_harm' },
  ]

  function onMessageSend(el) {
    const text = el?.value || el?.textContent || ''
    const firstChars = text.slice(0, 80)
    const lower = firstChars.toLowerCase()

    chrome.runtime.sendMessage({
      type: 'MESSAGE_SENT',
      app: APP,
      textLength: text.length,
      firstChars: lower,
    })

    if (!romanticSignalFired && ROMANTIC_KEYWORDS.some(k => lower.includes(k))) {
      romanticSignalFired = true
      chrome.runtime.sendMessage({ type: 'ROMANTIC_PATTERN', app: APP, frequency: 'detected' })
    }

    for (const { pattern, category } of HARMFUL_TOPICS) {
      if (pattern.test(firstChars)) {
        chrome.runtime.sendMessage({ type: 'HARMFUL_CONTENT', app: APP, category })
        break
      }
    }
  }

  function getInput() {
    return (
      document.querySelector('rich-textarea div[contenteditable="true"]') ||
      document.querySelector('div[contenteditable="true"][aria-label]') ||
      document.querySelector('textarea[aria-label]') ||
      document.querySelector('textarea')
    )
  }

  function attachListeners() {
    const input = getInput()
    if (!input || input.__sentraBound) return
    input.__sentraBound = true

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) onMessageSend(input)
    })

    // Gemini send button
    const sendBtn = document.querySelector('button.send-button, button[aria-label*="Send message"], button[data-mat-icon-name="send"]')
    if (sendBtn && !sendBtn.__sentraBound) {
      sendBtn.__sentraBound = true
      sendBtn.addEventListener('click', () => onMessageSend(input))
    }
  }

  const observer = new MutationObserver(() => attachListeners())
  observer.observe(document.body, { childList: true, subtree: true })
  attachListeners()

  const retryInterval = setInterval(() => {
    if (getInput()?.__sentraBound) clearInterval(retryInterval)
    else attachListeners()
  }, 2000)

  window.addEventListener('beforeunload', () => {
    clearInterval(retryInterval)
    observer.disconnect()
    chrome.runtime.sendMessage({ type: 'SESSION_END', app: APP })
  })
})()
