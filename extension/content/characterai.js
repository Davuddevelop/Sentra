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

  // Checked against full message text on-device only — content never sent to server
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

  function getPersonaName() {
    const title = document.title || ''
    const m = title.match(/^(.+?)\s*[\|–\-]/) || title.match(/chat with (.+)/i)
    return m ? m[1].trim().slice(0, 60) : null
  }

  // Character.AI has higher romantic risk — fire dependency signal after 30 min
  dependencyCheckTimer = setTimeout(() => {
    if (messageCount > 0) {
      chrome.runtime.sendMessage({
        type: 'EMOTIONAL_DEPENDENCY',
        app: APP,
        sessionsToday: 1,
        persona_name: getPersonaName(),
      })
    }
  }, 30 * 60 * 1000)

  function onMessageSend(text) {
    const preview = text.slice(0, 80)
    const lower = preview.toLowerCase()
    const fullLower = text.toLowerCase()
    messageCount++

    chrome.runtime.sendMessage({
      type: 'MESSAGE_SENT',
      app: APP,
      textLength: text.length,
      firstChars: lower,
    })

    // Crisis checks run against full text on-device — highest priority
    if (CRISIS_PATTERNS.some(p => p.test(fullLower))) {
      chrome.runtime.sendMessage({ type: 'HARMFUL_CONTENT', app: APP, category: 'crisis', urgent: true, persona_name: getPersonaName(), messageText: text.slice(0, 500) })
      return
    }
    if (GROOMING_PATTERNS.some(p => p.test(fullLower))) {
      chrome.runtime.sendMessage({ type: 'HARMFUL_CONTENT', app: APP, category: 'grooming', urgent: true, persona_name: getPersonaName(), messageText: text.slice(0, 500) })
      return
    }
    if (ABUSE_PATTERNS.some(p => p.test(fullLower))) {
      chrome.runtime.sendMessage({ type: 'HARMFUL_CONTENT', app: APP, category: 'abuse', urgent: true, persona_name: getPersonaName(), messageText: text.slice(0, 500) })
      return
    }

    if (!romanticSignalFired && ROMANTIC_KEYWORDS.some(k => lower.includes(k))) {
      romanticSignalFired = true
      chrome.runtime.sendMessage({
        type: 'ROMANTIC_PATTERN',
        app: APP,
        frequency: 'daily',
        persona_name: getPersonaName(),
        messageText: text.slice(0, 500),
      })
    }

    for (const { pattern, category } of HARMFUL_TOPICS) {
      if (pattern.test(preview)) {
        chrome.runtime.sendMessage({ type: 'HARMFUL_CONTENT', app: APP, category, persona_name: getPersonaName(), messageText: text.slice(0, 500) })
        break
      }
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
