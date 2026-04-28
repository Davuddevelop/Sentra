import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import db from '../db/schema.js'
import { analyzeSignal } from '../ai/analyzer.js'
import { sendAlertEmail } from '../services/email.js'
import { sendAlertPush } from '../services/push.js'

const router = Router()

const signalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  keyGenerator: (req) => req.headers['x-device-token'] || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Signal rate limit exceeded.' },
})

const RULE_SCORES = {
  'ai.romantic_roleplay':    85,
  'ai.jailbreak_attempt':    80,
  'ai.harmful_advice':       90,
  'ai.emotional_dependency': 60,
  'contact.unknown_dm':      70,
  'contact.off_platform':    75,
  'content.graphic':         88,
  'content.deepfake':        92,
  'screen.late_night':       40,
  'screen.excessive':        35,
  'privacy.data_shared':     65,
  'app.new_install':         20,
  'app.scan_clean':          0,
  'app.foreground':          5,
  'app.tamper_detected':     95,
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

/* ── POST /api/signal ────────────────────────────────────── */
router.post('/signal', signalLimiter, async (req, res) => {
  const deviceToken = req.headers['x-device-token']
  if (!deviceToken) return res.status(401).json({ error: 'Device token required.' })

  const device = await db.prepare('SELECT * FROM devices WHERE device_token = ?').get(deviceToken)
  if (!device) return res.status(401).json({ error: 'Unknown device.' })

  const { type, payload: rawPayload = {} } = req.body ?? {}
  if (!type) return res.status(400).json({ error: 'Signal type is required.' })

  const ALLOWED_KEYS = new Set([
    'app','platform','session_minutes','sessions_today','duration_minutes',
    'start_time','total_hours','day','apps_scanned','threats_found',
    'attempts','contact_type','contact_age_unknown','data_type',
    'topic_category','flagged','prompt_pattern','session_frequency',
    'persona_type','message','risk_score','level',
    'event','package_name','app_label','foreground_minutes',
    'late_night_hour','os_version','device_model',
  ])
  const payload = Object.fromEntries(
    Object.entries(rawPayload).filter(([k]) => ALLOWED_KEYS.has(k))
  )

  const child  = await db.prepare('SELECT * FROM children WHERE id = ?').get(device.child_id)
  const family = await db.prepare('SELECT * FROM families WHERE id = ?').get(child.family_id)
  const parent = await db.prepare('SELECT * FROM users WHERE id = ?').get(family.owner_id)

  const context = { child_name: child.name, child_age: child.age, device: device.name }
  const ai = await analyzeSignal(type, payload, context)

  const riskScore = ai?.risk_score ?? Math.min(100, RULE_SCORES[type] ?? 10)
  const level     = ai?.level     ?? ALERT_LEVEL(riskScore)
  const prefix    = type.split('.')[0]
  const category  = CATEGORY[prefix] || 'Activity'
  const title     = ai?.title ?? payload.title ?? `${category} signal on ${device.name}`
  const body      = ai?.body  ?? payload.body  ?? `Signal type: ${type}`

  const { lastInsertRowid: signalId } = await db
    .prepare('INSERT INTO signals (device_id, type, payload, risk_score) VALUES (?, ?, ?, ?)')
    .run(device.id, type, JSON.stringify(payload), riskScore)

  await db.prepare('UPDATE devices SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(device.id)

  let alertId = null
  if (riskScore >= 20) {
    const { lastInsertRowid } = await db.prepare(`
      INSERT INTO alerts (family_id, child_id, signal_id, level, category, title, body)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(child.family_id, child.id, signalId, level, category, title, body)
    alertId = lastInsertRowid

    if (level === 'warn' || level === 'critical') {
      setImmediate(() => {
        sendAlertEmail({ parentName: parent.name, parentEmail: parent.email, childName: child.name, alert: { level, title, body } })
        if (parent.push_token) {
          sendAlertPush({ pushToken: parent.push_token, childName: child.name, level, title })
        }
      })
    }
  }

  await db.prepare('UPDATE signals SET processed = 1 WHERE id = ?').run(signalId)

  res.json({ ok: true, risk_score: riskScore, level, alert_id: alertId, ai_powered: !!ai, device_name: device.name, child_name: child.name })
})

export default router
