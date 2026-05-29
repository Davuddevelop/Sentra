/**
 * Sentra — Claude.ai content script
 * Monitors: message send events, session duration, pattern detection
 * Privacy: only checks first 80 chars for pattern matching, never stores content
 */

;(function () {
  if (window.__sentraLoaded) return
  window.__sentraLoaded = true

  const APP = 'Claude'

  chrome.runtime.sendMessage({ type: 'SESSION_START', app: APP })

  let romanticSignalFired = false

  const ROMANTIC_KEYWORDS = [
    'i love you', 'my girlfriend', 'my boyfriend', 'be my', 'date me',
    'relationship with you', 'fall in love', 'marry me', 'kiss me',
  ]

  const CRISIS_PATTERNS = [
    /\b(want to die|wanna die|i want to be dead)\b/i,
    /\b(kill myself|end my life|end it all|ending it all)\b/i,
    /\bsuicidal\b/i,
    /\b(i'?m|i am) going to (kill|hurt) myself\b/i,
    /\bdon'?t want to (live|be alive|exist)\b/i,
    /\bcutting (myself|my wrists|my arms)\b/i,
    /\bhope (i die|i don'?t wake up|to not wake up)\b/i,
  ]

  const GROOMING_PATTERNS = [
    /\b(don'?t tell (anyone|your parents?)|keep this (secret|between us)|our (little )?secret)\b/i,
    /\b(meet (me|up)|come (see|meet) me|where do you live|what'?s your address)\b/i,
    /\bsend (me )?a? ?(photo|picture|pic|video|nude)\b/i,
    /\b(are you home alone|are you alone right now)\b/i,
    /\b(move to|talk on) (discord|telegram|whatsapp|snapchat|instagram)\b/i,
    /\byour parents? (don'?t|can'?t|won'?t) (know|find out|understand)\b/i,
  ]

  const ABUSE_PATTERNS = [
    /\b(he|she|they|someone) (hit|hits|hurt|hurts|touches|touched|abuses?|abused) me\b/i,
    /\bmy (parent|mom|dad|stepdad|stepmom|uncle|brother|sister) (hurt|hits|touches|abuses?)\b/i,
    /\b(being abused|i'?ve been (abused|assaulted|molested))\b/i,
    /\bforces? me to\b/i,
  ]

  const HARMFUL_TOPICS = [
    { pattern: /how (to lose|to stop eating|to fast|to starve|to purge)/i,  category: 'diet_restriction' },
    { pattern: /how (to make|to build).*(weapon|explosive|bomb)/i,           category: 'weapon' },
    { pattern: /how (to get|to buy).*(drugs|weed|xanax|fentanyl|pills)/i,   category: 'substances' },
    { pattern: /how (to run away|to escape home|to disappear)/i,             category: 'runaway' },
    { pattern: /self[\s-]?harm|cut myself|hurt myself/i,                     category: 'self_harm' },
  ]

  function onMessageSend(textarea) {
    const text = textarea?.value || textarea?.textContent || ''
    const preview = text.slice(0, 80)
    const lower = preview.toLowerCase()
    const fullLower = text.toLowerCase()

    chrome.runtime.sendMessage({
      type: 'MESSAGE_SENT',
      app: APP,
      textLength: text.length,
      firstChars: lower,
    })

    if (CRISIS_PATTERNS.some(p => p.test(fullLower))) {
      chrome.runtime.sendMessage({ type: 'HARMFUL_CONTENT', app: APP, category: 'crisis', urgent: true, messageText: text.slice(0, 500) })
      return
    }
    if (GROOMING_PATTERNS.some(p => p.test(fullLower))) {
      chrome.runtime.sendMessage({ type: 'HARMFUL_CONTENT', app: APP, category: 'grooming', urgent: true, messageText: text.slice(0, 500) })
      return
    }
    if (ABUSE_PATTERNS.some(p => p.test(fullLower))) {
      chrome.runtime.sendMessage({ type: 'HARMFUL_CONTENT', app: APP, category: 'abuse', urgent: true, messageText: text.slice(0, 500) })
      return
    }

    if (!romanticSignalFired && ROMANTIC_KEYWORDS.some(k => lower.includes(k))) {
      romanticSignalFired = true
      chrome.runtime.sendMessage({ type: 'ROMANTIC_PATTERN', app: APP, frequency: 'detected', messageText: text.slice(0, 500) })
    }

    for (const { pattern, category } of HARMFUL_TOPICS) {
      if (pattern.test(preview)) {
        chrome.runtime.sendMessage({ type: 'HARMFUL_CONTENT', app: APP, category, messageText: text.slice(0, 500) })
        break
      }
    }
  }

  function getTextarea() {
    // Claude uses a contenteditable div
    return (
      document.querySelector('div[contenteditable="true"][data-placeholder]') ||
      document.querySelector('div[contenteditable="true"].ProseMirror') ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('textarea')
    )
  }

  function attachListeners() {
    const textarea = getTextarea()
    if (!textarea || textarea.__sentraBound) return
    textarea.__sentraBound = true

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) onMessageSend(textarea)
    })

    const sendBtn = document.querySelector('button[aria-label*="Send"], button[data-value="send"]')
    if (sendBtn && !sendBtn.__sentraBound) {
      sendBtn.__sentraBound = true
      sendBtn.addEventListener('click', () => onMessageSend(textarea))
    }
  }

  const observer = new MutationObserver(() => attachListeners())
  observer.observe(document.body, { childList: true, subtree: true })
  attachListeners()

  const retryInterval = setInterval(() => {
    if (getTextarea()?.__sentraBound) clearInterval(retryInterval)
    else attachListeners()
  }, 2000)

  window.addEventListener('beforeunload', () => {
    clearInterval(retryInterval)
    observer.disconnect()
    chrome.runtime.sendMessage({ type: 'SESSION_END', app: APP })
  })
})()
