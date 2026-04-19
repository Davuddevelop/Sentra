import { Router } from 'express'
import db from '../db/schema.js'
import { analyzeSignal } from '../ai/analyzer.js'
import { sendAlertEmail } from '../services/email.js'
import { sendAlertPush } from '../services/push.js'

const router = Router()

const RULE_SCORES = {
  // AI chatbot signals (browser extension + Android accessibility)
  'ai.romantic_roleplay':    85,
  'ai.jailbreak_attempt':    80,
  'ai.harmful_advice':       90,
  'ai.emotional_dependency': 60,

  // Contact signals
  'contact.unknown_dm':      70,
  'contact.off_platform':    75,

  // Content signals
  'content.graphic':         88,
  'content.deepfake':        92,

  // Screen time signals (mobile + browser)
  'screen.late_night':       40,
  'screen.excessive':        35,

  // Privacy signals
  'privacy.data_shared':     65,

  // App lifecycle signals
  'app.new_install':         20,
  'app.scan_clean':          0,
  'app.foreground':          5,   // mobile: AI app opened

  // Mobile tamper signals
  'app.tamper_detected':     95,  // device admin removed — critical
}

const ALERT_LEVEL = s => s >= 80 ? 'critical' : s >= 60 ? 'warn' : s >= 20 ? 'info' : 'ok'

const CATEGORY = {
  ai:      'AI Activity',
  contact: 'Contact',
  content: 'Content',
  screen:  'Screen Time',
  privacy: 'Privacy',
  app:     'App Activity',
}

/* ── POST /api/signal ─────────────────────────────────────────
   Called by child device agent or browser extension.
   Auth: X-Device-Token header.
────────────────────────────────────────────────────────────── */
router.post('/signal', async (req, res) => {
  const deviceToken = req.headers['x-device-token']
  if (!deviceToken) return res.status(401).json({ error: 'Device token required.' })

  const device = db.prepare('SELECT * FROM devices WHERE device_token = ?').get(deviceToken)
  if (!device) return res.status(401).json({ error: 'Unknown device.' })

  const { type, payload: rawPayload = {} } = req.body ?? {}
  if (!type) return res.status(400).json({ error: 'Signal type is required.' })

  // Zero-Knowledge: strip any text fields before storing — metadata only
  const ALLOWED_KEYS = new Set([
    // Common
    'app','platform','session_minutes','sessions_today','duration_minutes',
    'start_time','total_hours','day','apps_scanned','threats_found',
    'attempts','contact_type','contact_age_unknown','data_type',
    'topic_category','flagged','prompt_pattern','session_frequency',
    'persona_type','message','risk_score','level',
    // Mobile-specific
    'event','package_name','app_label','foreground_minutes',
    'late_night_hour','os_version','device_model',
  ])
  const payload = Object.fromEntries(
    Object.entries(rawPayload).filter(([k]) => ALLOWED_KEYS.has(k))
  )

  const child  = db.prepare('SELECT * FROM children WHERE id = ?').get(device.child_id)
  const family = db.prepare('SELECT * FROM families WHERE id = ?').get(child.family_id)
  const parent = db.prepare('SELECT * FROM users WHERE id = ?').get(family.owner_id)

  // ── 1. Try Claude AI analysis ──────────────────────────────
  const context = { child_name: child.name, child_age: child.age, device: device.name }
  const ai = await analyzeSignal(type, payload, context)

  // ── 2. Fall back to rule-based scoring ────────────────────
  const riskScore = ai?.risk_score ?? Math.min(100, RULE_SCORES[type] ?? 10)
  const level     = ai?.level     ?? ALERT_LEVEL(riskScore)
  const prefix    = type.split('.')[0]
  const category  = CATEGORY[prefix] || 'Activity'
  const title     = ai?.title ?? payload.title  ?? `${category} signal on ${device.name}`
  const body      = ai?.body  ?? payload.body   ?? `Signal type: ${type}`

  // ── 3. Store raw signal ───────────────────────────────────
  const { lastInsertRowid: signalId } = db
    .prepare('INSERT INTO signals (device_id, type, payload, risk_score) VALUES (?, ?, ?, ?)')
    .run(device.id, type, JSON.stringify(payload), riskScore)

  db.prepare('UPDATE devices SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(device.id)

  // ── 4. Create alert if significant ───────────────────────
  let alertId = null
  if (riskScore >= 20) {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO alerts (family_id, child_id, signal_id, level, category, title, body)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(child.family_id, child.id, signalId, level, category, title, body)
    alertId = lastInsertRowid

    // ── 5. Email + push parent on warn/critical ───────────
    if (level === 'warn' || level === 'critical') {
      setImmediate(() => {
        sendAlertEmail({
          parentName:  parent.name,
          parentEmail: parent.email,
          childName:   child.name,
          alert:       { level, title, body },
        })
        if (parent.push_token) {
          sendAlertPush({ pushToken: parent.push_token, childName: child.name, level, title })
        }
      })
    }
  }

  db.prepare('UPDATE signals SET processed = 1 WHERE id = ?').run(signalId)

  res.json({
    ok: true,
    risk_score: riskScore,
    level,
    alert_id: alertId,
    ai_powered: !!ai,
    device_name: device.name,
    child_name: child.name,
  })
})

export default router
