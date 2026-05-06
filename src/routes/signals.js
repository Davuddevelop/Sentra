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

  const { type, payload: rawPayload = {} } = req.body ?? {}
  if (!type) return res.status(400).json({ error: 'Signal type is required.' })

  // Single JOIN replaces 4 sequential queries
  const row = await db.prepare(`
    SELECT d.id as device_id, d.name as device_name, d.child_id,
           c.name as child_name, c.age as child_age, c.family_id,
           u.name as parent_name, u.email as parent_email, u.push_token
    FROM devices d
    JOIN children c ON c.id = d.child_id
    JOIN families f ON f.id = c.family_id
    JOIN users    u ON u.id = f.owner_id
    WHERE d.device_token = ?
  `).get(deviceToken)
  if (!row) return res.status(401).json({ error: 'Unknown device.' })

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

  const ruleScore = Math.min(100, RULE_SCORES[type] ?? 10)
  const context   = { child_name: row.child_name, child_age: row.child_age, device: row.device_name }

  // Only call AI for signals that matter — skip zero/low-risk noise
  const ai = ruleScore >= 20 ? await analyzeSignal(type, payload, context) : null

  const riskScore = ai?.risk_score ?? ruleScore
  const level     = ai?.level     ?? ALERT_LEVEL(riskScore)
  const prefix    = type.split('.')[0]
  const category  = CATEGORY[prefix] || 'Activity'
  const title     = ai?.title ?? payload.title ?? `${category} signal on ${row.device_name}`
  const body      = ai?.body  ?? payload.body  ?? `Signal type: ${type}`

  // Batch the two writes into one round-trip where possible
  const [{ lastInsertRowid: signalId }] = await Promise.all([
    db.prepare('INSERT INTO signals (device_id, type, payload, risk_score, processed) VALUES (?, ?, ?, ?, 1)')
      .run(row.device_id, type, JSON.stringify(payload), riskScore),
    db.prepare('UPDATE devices SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(row.device_id),
  ])

  let alertId = null
  if (riskScore >= 20) {
    const { lastInsertRowid } = await db.prepare(`
      INSERT INTO alerts (family_id, child_id, signal_id, level, category, title, body)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(row.family_id, row.child_id, signalId, level, category, title, body)
    alertId = lastInsertRowid

    if (level === 'warn' || level === 'critical') {
      setImmediate(() => {
        sendAlertEmail({ parentName: row.parent_name, parentEmail: row.parent_email, childName: row.child_name, alert: { level, title, body } })
        if (row.push_token) {
          sendAlertPush({ pushToken: row.push_token, childName: row.child_name, level, title })
        }
      })
    }
  }

  res.json({ ok: true, risk_score: riskScore, level, alert_id: alertId, ai_powered: !!ai, device_name: row.device_name, child_name: row.child_name })
})

export default router
