import { Router } from 'express'
import { timingSafeEqual } from 'crypto'
import db from '../db/schema.js'
import { sendWeeklyDigest } from '../services/email.js'
import { generateInsights } from '../agents/insights.js'
import { generateGrowthInsights } from '../agents/growth.js'

const router = Router()

function verifyCron(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next()
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron] CRON_SECRET not configured — rejecting request')
    return res.status(500).json({ error: 'Cron not configured' })
  }
  const provided = req.headers.authorization ?? ''
  const expected = `Bearer ${secret}`
  const match = provided.length === expected.length &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  if (!match) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

/* ── GET /api/cron/purge — runs daily at midnight ────────── */
router.get('/purge', verifyCron, async (_req, res) => {
  const { changes: s } = await db.prepare("DELETE FROM signals WHERE created_at < datetime('now', '-90 days')").run()
  const { changes: a } = await db.prepare("DELETE FROM alerts  WHERE created_at < datetime('now', '-90 days')").run()
  // child_insights older than 90 days — matches the data retention promise in the privacy policy
  const { changes: i } = await db.prepare("DELETE FROM child_insights WHERE created_at < datetime('now', '-90 days')").run()
  console.log(`[cron/purge] removed ${s} signals, ${a} alerts, ${i} insights`)
  res.json({ ok: true, signals: s, alerts: a, insights: i })
})

/* ── GET /api/cron/weekly-digest — runs Sunday 08:00 ─────── */
router.get('/weekly-digest', verifyCron, async (_req, res) => {
  const now      = new Date()
  const weekEnd   = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const weekStart = new Date(now - 6 * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  // 2 queries replace O(families × children × 3) sequential queries
  const [families, childRows, signalRows] = await Promise.all([
    db.prepare(`
      SELECT f.id, f.owner_id, u.name as parent_name, u.email as parent_email, u.plan
      FROM families f JOIN users u ON u.id = f.owner_id
    `).all(),
    db.prepare(`
      SELECT c.id, c.name, c.age, c.family_id,
        COUNT(DISTINCT s.id) as signals,
        SUM(CASE WHEN a.level='critical' THEN 1 ELSE 0 END) as critical,
        SUM(CASE WHEN a.level='warn'     THEN 1 ELSE 0 END) as warn
      FROM children c
      LEFT JOIN devices d ON d.child_id = c.id
      LEFT JOIN signals s ON s.device_id = d.id AND s.created_at > datetime('now', '-7 days')
      LEFT JOIN alerts  a ON a.child_id  = c.id AND a.created_at > datetime('now', '-7 days')
      GROUP BY c.id, c.name, c.age, c.family_id
    `).all(),
    db.prepare(`
      SELECT s.type, d.child_id
      FROM signals s
      JOIN devices d ON d.id = s.device_id
      WHERE s.created_at > datetime('now', '-7 days')
    `).all(),
  ])

  // Build type-count breakdowns per child for InsightsAgent
  const typeCountsByChild = {}
  for (const r of signalRows) {
    const map = (typeCountsByChild[r.child_id] ??= {})
    map[r.type] = (map[r.type] ?? 0) + 1
  }

  const statsByFamily = {}
  for (const r of childRows) {
    (statsByFamily[r.family_id] ??= []).push({
      id: r.id, name: r.name, age: r.age,
      signals: r.signals ?? 0, critical: r.critical ?? 0, warn: r.warn ?? 0,
    })
  }

  let sent = 0
  for (const family of families) {
    const childStats   = statsByFamily[family.id] ?? []
    const totalSignals = childStats.reduce((s, c) => s + c.signals, 0)
    if (totalSignals === 0) continue

    // InsightsAgent: generate per-child insights in parallel (Family + Family+ only)
    const aiEnabled = family.plan !== 'starter'
    const childrenWithInsights = await Promise.all(
      childStats.map(async c => ({
        ...c,
        insights: aiEnabled
          ? await generateInsights({
              childName:    c.name,
              childAge:     c.age,
              typeCounts:   typeCountsByChild[c.id] ?? {},
              criticalCount: c.critical,
              warnCount:    c.warn,
              totalSignals: c.signals,
            })
          : null,
      }))
    )

    await sendWeeklyDigest({
      parentName:  family.parent_name,
      parentEmail: family.parent_email,
      children:    childrenWithInsights,
      weekStart,
      weekEnd,
    })
    sent++
  }

  res.json({ ok: true, sent })
})

/* ── GET /api/cron/monthly-insights — runs 1st of each month ─ */
router.get('/monthly-insights', verifyCron, async (_req, res) => {
  const period = new Date().toISOString().slice(0, 7) // "YYYY-MM"
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30)
  const cutoffISO = cutoff.toISOString()

  // All children with at least one signal in the last 30 days — family+ plan only
  const activeChildren = await db.prepare(`
    SELECT DISTINCT c.id, c.name, c.age, c.family_id, u.plan
    FROM children c
    JOIN devices d ON d.child_id = c.id
    JOIN signals s ON s.device_id = d.id
    JOIN families f ON f.id = c.family_id
    JOIN users    u ON u.id = f.owner_id
    WHERE s.created_at > ?
  `).all(cutoffISO)

  let generated = 0
  for (const child of activeChildren) {
    // Growth insights are a Family+ exclusive feature
    if (child.plan !== 'family-plus') continue

    // Skip if already generated for this period
    const existing = await db.prepare('SELECT id FROM child_insights WHERE child_id = ? AND period = ?').get(child.id, period)
    if (existing) continue

    // Gather data in parallel
    const [signalRows, alertRows] = await Promise.all([
      db.prepare(`
        SELECT s.type, s.payload, s.created_at
        FROM signals s JOIN devices d ON d.id = s.device_id
        WHERE d.child_id = ? AND s.created_at > ?
      `).all(child.id, cutoffISO),
      db.prepare(`
        SELECT a.category, a.title, a.level
        FROM alerts a
        WHERE a.child_id = ? AND a.created_at > ?
          AND a.category NOT IN ('mental')
      `).all(child.id, cutoffISO),
    ])

    // Build app usage counts from signal payloads
    const appUsage = {}
    const topicSignals = {}
    let lateNightCount = 0
    let totalSessionMins = 0
    let sessionCount = 0

    for (const s of signalRows) {
      const payload = typeof s.payload === 'string' ? JSON.parse(s.payload) : s.payload
      if (payload?.app) {
        appUsage[payload.app] = (appUsage[payload.app] ?? 0) + 1
      }
      if (payload?.topic_category) {
        topicSignals[payload.topic_category] = (topicSignals[payload.topic_category] ?? 0) + 1
      }
      if (s.type === 'screen.late_night') lateNightCount++
      if (payload?.session_minutes) {
        totalSessionMins += payload.session_minutes
        sessionCount++
      }
    }

    const avgSessionMins = sessionCount > 0 ? Math.round(totalSessionMins / sessionCount) : null
    const alertTitles = alertRows
      .filter(a => a.level !== 'critical') // exclude crisis alerts from growth context
      .map(a => a.title)

    const insights = await generateGrowthInsights({
      childName:       child.name,
      childAge:        child.age,
      appUsage,
      topicSignals,
      sessionPatterns: { avgSessionMins, lateNightCount, totalSessions: signalRows.length },
      alertTitles,
    })

    if (!insights) continue

    await db.prepare(`
      INSERT OR REPLACE INTO child_insights
        (child_id, period, interests, thinking_style, curiosity_themes, growth_narrative, engagement_pattern, conversation_prompts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      child.id, period,
      JSON.stringify(insights.interests ?? null),
      insights.thinking_style ?? null,
      JSON.stringify(insights.curiosity_themes ?? null),
      insights.growth_narrative ?? null,
      insights.engagement_pattern ?? null,
      JSON.stringify(insights.conversation_prompts ?? null),
    )
    generated++
  }

  res.json({ ok: true, period, generated })
})

/* ── GET /api/cron/check-tamper — runs every 12h ─────────────────────────── */
// Finds devices that sent signals recently but have gone silent for 48h+.
// Silence after activity = likely disabled. Creates a tamper alert per device.
router.get('/check-tamper', verifyCron, async (_req, res) => {
  const { sendAlertEmail } = await import('../services/email.js')
  const { sendAlertPush }  = await import('../services/push.js')

  // Devices that had a signal in the last 14 days but nothing in the last 48h
  const silentDevices = await db.prepare(`
    SELECT d.id as device_id, d.name as device_name, d.child_id,
           c.name as child_name, c.family_id,
           u.name as parent_name, u.email as parent_email, u.push_token,
           MAX(s.created_at) as last_signal
    FROM devices d
    JOIN children c  ON c.id = d.child_id
    JOIN families f  ON f.id = c.family_id
    JOIN users    u  ON u.id = f.owner_id
    JOIN signals  s  ON s.device_id = d.id
    WHERE s.created_at > datetime('now', '-14 days')
    GROUP BY d.id
    HAVING last_signal < datetime('now', '-48 hours')
  `).all()

  let alerted = 0
  for (const row of silentDevices) {
    // Don't spam — skip if we already sent a tamper alert for this device in the last 7 days
    const recent = await db.prepare(`
      SELECT id FROM alerts
      WHERE child_id = ? AND category = 'App Activity'
        AND title LIKE '%went silent%'
        AND created_at > datetime('now', '-7 days')
    `).get(row.child_id)
    if (recent) continue

    const title = `Sentra went silent on ${row.device_name}`
    const body  = `No activity detected on ${row.child_name}'s device for 48+ hours. The extension may have been disabled.`

    const { lastInsertRowid: signalId } = await db.prepare(
      'INSERT INTO signals (device_id, type, payload, risk_score, processed) VALUES (?, ?, ?, ?, 1)'
    ).run(row.device_id, 'app.tamper_detected', JSON.stringify({ event: 'silent', last_signal: row.last_signal }), 75)

    await db.prepare(
      'INSERT INTO alerts (family_id, child_id, signal_id, level, category, title, body) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(row.family_id, row.child_id, signalId, 'warn', 'App Activity', title, body)

    sendAlertEmail({ parentName: row.parent_name, parentEmail: row.parent_email, childName: row.child_name, alert: { level: 'warn', title, body } })
    if (row.push_token) sendAlertPush({ pushToken: row.push_token, childName: row.child_name, level: 'warn', title })
    alerted++
  }

  res.json({ ok: true, alerted })
})

export default router
