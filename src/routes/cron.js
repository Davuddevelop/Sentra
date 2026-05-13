import { Router } from 'express'
import db from '../db/schema.js'
import { sendWeeklyDigest } from '../services/email.js'
import { generateInsights } from '../agents/insights.js'

const router = Router()

function verifyCron(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next()
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron] CRON_SECRET not configured — rejecting request')
    return res.status(500).json({ error: 'Cron not configured' })
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
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

export default router
