/**
 * Sentra — ChatGPT content script
 * Monitors: message send events, session duration, pattern detection
 * Privacy: only checks first 80 chars for pattern matching, never stores content
 */

;(function () {
  if (window.__sentraLoaded) return
  window.__sentraLoaded = true

  const APP = 'ChatGPT'

  // ── Notify background of session start ──────────────────────────────────────
  chrome.runtime.sendMessage({ type: 'SESSION_START', app: APP })

  let messageCount = 0
  let romanticSignalFired = false

  // Romantic/dependency persona keywords (pattern detection only — no content logged)
  const ROMANTIC_KEYWORDS = [
    'i love you', 'my girlfriend', 'my boyfriend', 'be my', 'date me',
    'relationship with you', 'fall in love', 'marry me', 'kiss me',
  ]

  const HARMFUL_TOPICS = [
    { pattern: /how (to lose|to stop eating|to fast|to starve)/i, category: 'diet_restriction' },
    { pattern: /how (to make|to build).*(weapon|explosive|bomb)/i, category: 'weapon' },
    { pattern: /how (to get|to buy).*(drugs|weed|xanax)/i, category: 'substances' },
    { pattern: /how (to run away|to escape home)/i, category: 'runaway' },
    { pattern: /self.harm|cut myself|hurt myself/i, category: 'self_harm' },
  ]

  // ── Intercept form submit / button click (send message) ────────────────────
  function onMessageSend(textarea) {
    const text = textarea?.value || ''
    const firstChars = text.slice(0, 80)
    const lower = firstChars.toLowerCase()

    messageCount++
    chrome.runtime.sendMessage({
      type: 'MESSAGE_SENT',
      app: APP,
      textLength: text.length,
      firstChars: lower,
    })

    // Romantic pattern check
    if (!romanticSignalFired && ROMANTIC_KEYWORDS.some(k => lower.includes(k))) {
      romanticSignalFired = true
      chrome.runtime.sendMessage({ type: 'ROMANTIC_PATTERN', app: APP, frequency: 'detected' })
    }

    // Harmful content check
    for (const { pattern, category } of HARMFUL_TOPICS) {
      if (pattern.test(firstChars)) {
        chrome.runtime.sendMessage({ type: 'HARMFUL_CONTENT', app: APP, category })
        break
      }
    }
  }

  // ── Observe the send button / Enter key ─────────────────────────────────────
  function attachListeners() {
    // ChatGPT uses a <textarea> with data-id="root"
    const textarea = document.querySelector('textarea[data-id], #prompt-textarea, textarea[placeholder]')
    if (!textarea) return

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        onMessageSend(textarea)
      }
    })

    // Also watch for the send button
    const sendBtn = document.querySelector('[data-testid="send-button"], button[aria-label*="Send"]')
    if (sendBtn) {
      sendBtn.addEventListener('click', () => onMessageSend(textarea))
    }
  }

  // ChatGPT is a SPA — observe DOM mutations to re-attach
  const observer = new MutationObserver(() => attachListeners())
  observer.observe(document.body, { childList: true, subtree: true })
  attachListeners()

  // ── Session end on page unload ───────────────────────────────────────────────
  window.addEventListener('beforeunload', () => {
    chrome.runtime.sendMessage({ type: 'SESSION_END', app: APP })
  })
})()
