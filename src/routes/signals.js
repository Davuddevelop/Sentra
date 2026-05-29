import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import db from '../db/schema.js'
import { analyzeSignal } from '../ai/analyzer.js'
import { generateGuidance } from '../agents/guidance.js'
import { checkAndIncrementAiCap } from '../ai/quota.js'
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
  // Mental health — crisis tier (always critical, bypass AI analyzer)
  'mental.crisis_language':    99,
  'mental.grooming_detected':  97,
  'mental.abuse_disclosed':    96,
  'mental.isolation_pattern':  65,
  // AI behaviour
  'ai.romantic_roleplay':      85,
  'ai.jailbreak_attempt':      80,
  'ai.harmful_advice':         90,
  'ai.emotional_dependency':   60,
  // Contact
  'contact.unknown_dm':        70,
  'contact.off_platform':      75,
  // Content
  'content.graphic':           88,
  'content.deepfake':          92,
  // Screen time
  'screen.late_night':         40,
  'screen.excessive':          35,
  // Privacy / app
  'privacy.data_shared':       65,
  'app.new_install':           20,
  'app.scan_clean':            0,
  'app.foreground':            5,
  'app.tamper_detected':       95,
}

const ALERT_LEVEL = s => s >= 80 ? 'critical' : s >= 60 ? 'warn' : s >= 20 ? 'info' : 'ok'

const CATEGORY = {
  mental:  'Mental Health',
  ai:      'AI Activity',
  contact: 'Contact',
  content: 'Content',
  screen:  'Screen Time',
  privacy: 'Privacy',
  app:     'App Activity',
}

// Crisis signals skip AI enrichment — rule score is definitive
const CRISIS_TYPES = new Set([
  'mental.crisis_language',
  'mental.grooming_detected',
  'mental.abuse_disclosed',
])

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
           u.name as parent_name, u.email as parent_email, u.push_token, u.plan
    FROM devices d
    JOIN children c ON c.id = d.child_id
    JOIN families f ON f.id = c.family_id
    JOIN users    u ON u.id = f.owner_id
    WHERE d.device_token = ?
  `).get(deviceToken)
  if (!row) return res.status(401).json({ error: 'Unknown device.' })

  // Extract message_text BEFORE the allowlist — used for AI analysis only, never stored in DB
  const messageText = typeof rawPayload?.message_text === 'string' && rawPayload.message_text.length > 0
    ? rawPayload.message_text.slice(0, 500)
    : null

  const ALLOWED_KEYS = new Set([
    'app','platform','session_minutes','sessions_today','duration_minutes',
    'start_time','total_hours','day','apps_scanned','threats_found',
    'attempts','contact_type','contact_age_unknown','data_type',
    'topic_category','flagged','prompt_pattern','session_frequency',
    'persona_type','persona_name','message','risk_score','level',
    'event','package_name','app_label','foreground_minutes',
    'late_night_hour','os_version','device_model',
    'urgent',
  ])
  const payload = Object.fromEntries(
    Object.entries(rawPayload).filter(([k]) => ALLOWED_KEYS.has(k))
  )

  const ruleScore = Math.min(100, RULE_SCORES[type] ?? 10)
  const context   = { child_name: row.child_name, child_age: row.child_age, device: row.device_name }

  // Starter plan: rule-based only — Claude API is never called
  const planAllowsAI = row.plan !== 'starter'

  // Run AI when plan allows, signal is significant, and quota remains.
  // Crisis signals are included — AI can generate a better parent message,
  // but ruleScore floor below ensures the score never drops below the rule minimum.
  const ai = (planAllowsAI && ruleScore >= 20 &&
    await checkAndIncrementAiCap(row.family_id, row.plan))
    ? await analyzeSignal(type, payload, context, messageText)
    : null

  // AI can't downgrade a rule score (e.g. crisis stays at 99 even if AI returns 80)
  const riskScore = ai ? Math.max(ai.risk_score, ruleScore) : ruleScore
  const level     = ai?.level     ?? ALERT_LEVEL(riskScore)
  const prefix    = type.split('.')[0]
  const category  = CATEGORY[prefix] || 'Activity'
  const title     = ai?.title ?? payload.title ?? `${category} signal on ${row.device_name}`
  const body      = ai?.body  ?? payload.body  ?? `Signal type: ${type}`

  let signalId
  try {
    const insertResult = await db
      .prepare('INSERT INTO signals (device_id, type, payload, risk_score, processed) VALUES (?, ?, ?, ?, 1)')
      .run(row.device_id, type, JSON.stringify(payload), riskScore)
    signalId = insertResult.lastInsertRowid
    // Fire-and-forget — last_seen update is non-critical
    db.prepare('UPDATE devices SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(row.device_id).catch(() => null)
  } catch (err) {
    console.error('[signals] DB write failed:', err.message)
    return res.status(500).json({ error: 'Failed to record signal.' })
  }

  let alertId = null
  if (riskScore >= 20) {
    const { lastInsertRowid } = await db.prepare(`
      INSERT INTO alerts (family_id, child_id, signal_id, level, category, title, body)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(row.family_id, row.child_id, signalId, level, category, title, body)
    alertId = lastInsertRowid

    if (level === 'warn' || level === 'critical') {
      setImmediate(async () => {
        // How many times has this signal type fired in the last 7 days?
        const recentRow = await db.prepare(
          `SELECT COUNT(*) as count FROM signals WHERE device_id = ? AND type = ? AND created_at > datetime('now', '-7 days')`
        ).get(row.device_id, type).catch(err => { console.error('[signals] recentRow query failed:', err.message); return null })
        const recentCount = recentRow?.count ?? 1

        // GuidanceAgent: generates parent-facing explanation + action + conversation starter
        // Skip for starter plan or when monthly cap is already reached
        const guidanceAllowed = planAllowsAI &&
          await checkAndIncrementAiCap(row.family_id, row.plan)
        const guidance = guidanceAllowed
          ? await generateGuidance({
              type, level, title,
              childAge:       row.child_age,
              platform:       payload.app || type.split('.')[0],
              recentCount,
              messageContext: messageText,
            })
          : null
        if (guidance) {
          await db.prepare('UPDATE alerts SET guidance = ? WHERE id = ?')
            .run(JSON.stringify(guidance), alertId)
            .catch(() => null)
        }

        sendAlertEmail({
          parentName:  row.parent_name,
          parentEmail: row.parent_email,
          childName:   row.child_name,
          alert:       { level, title, body, guidance },
        })
        if (row.push_token) {
          sendAlertPush({ pushToken: row.push_token, childName: row.child_name, level, title })
        }
      })
    }
  }

  res.json({ ok: true, risk_score: riskScore, level, alert_id: alertId, ai_powered: !!ai, device_name: row.device_name, child_name: row.child_name })
})

/* ── GET /api/signal/uninstall — called by Chrome when extension is removed ── */
// No auth — Chrome opens this URL server-side when user uninstalls the extension.
// Token is validated by format + DB lookup only.
router.get('/signal/uninstall', async (req, res) => {
  const APP_URL = process.env.APP_URL || 'https://sentra-peach-delta.vercel.app'
  const { token } = req.query
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return res.redirect(APP_URL)

  const row = await db.prepare(`
    SELECT d.id as device_id, d.name as device_name, d.child_id,
           c.name as child_name, c.family_id,
           u.name as parent_name, u.email as parent_email, u.push_token
    FROM devices d
    JOIN children c ON c.id = d.child_id
    JOIN families f ON f.id = c.family_id
    JOIN users    u ON u.id = f.owner_id
    WHERE d.device_token = ?
  `).get(token).catch(() => null)

  if (!row) return res.redirect(APP_URL)

  const riskScore = 95
  const title = `Sentra removed from ${row.device_name}`
  const body  = `Monitoring was disabled on ${row.child_name}'s device. Check in with them today.`

  const { lastInsertRowid: signalId } = await db.prepare(
    'INSERT INTO signals (device_id, type, payload, risk_score, processed) VALUES (?, ?, ?, ?, 1)'
  ).run(row.device_id, 'app.tamper_detected', JSON.stringify({ event: 'uninstalled', device: row.device_name }), riskScore)

  await db.prepare(
    'INSERT INTO alerts (family_id, child_id, signal_id, level, category, title, body) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(row.family_id, row.child_id, signalId, 'critical', 'App Activity', title, body)

  sendAlertEmail({ parentName: row.parent_name, parentEmail: row.parent_email, childName: row.child_name, alert: { level: 'critical', title, body } })
  if (row.push_token) sendAlertPush({ pushToken: row.push_token, childName: row.child_name, level: 'critical', title })

  res.redirect(APP_URL)
})

export default router
