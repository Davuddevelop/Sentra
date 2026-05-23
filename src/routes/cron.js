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
  console.log(`[cron/purge] removed ${s} signals, ${a} alerts`)
  res.json({ ok: true, signals: s, alerts: a })
})

/* ── GET /api/cron/weekly-digest — runs Sunday 08:00 ─────── */
router.get('/weekly-digest', verifyCron, async (_req, res) => {
  const now      = new Date()
  const weekEnd   = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const weekStart = new Date(now - 6 * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  // 2 queries replace O(families × children × 3) sequential queries
  const [families, childRows, signalRows] = await Promise.all([
    db.prepare(`
      SELECT f.id, f.owner_id, u.name as parent_name, u.email as parent_email
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

    // InsightsAgent: generate per-child insights in parallel
    const childrenWithInsights = await Promise.all(
      childStats.map(async c => ({
        ...c,
        insights: await generateInsights({
          childName:    c.name,
          childAge:     c.age,
          typeCounts:   typeCountsByChild[c.id] ?? {},
          criticalCount: c.critical,
          warnCount:    c.warn,
          totalSignals: c.signals,
        }),
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

  // All children with at least one signal in the last 30 days
  const activeChildren = await db.prepare(`
    SELECT DISTINCT c.id, c.name, c.age, c.family_id
    FROM children c
    JOIN devices d ON d.child_id = c.id
    JOIN signals s ON s.device_id = d.id
    WHERE s.created_at > ?
  `).all(cutoffISO)

  let generated = 0
  for (const child of activeChildren) {
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

export default router
