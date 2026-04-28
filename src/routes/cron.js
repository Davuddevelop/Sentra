import { Router } from 'express'
import db from '../db/schema.js'
import { sendWeeklyDigest } from '../services/email.js'

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
  const families = await db.prepare('SELECT * FROM families').all()
  const now      = new Date()
  const weekEnd   = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const weekStart = new Date(now - 6 * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  let sent = 0

  for (const family of families) {
    const parent = await db.prepare('SELECT * FROM users WHERE id = ?').get(family.owner_id)
    if (!parent) continue

    const children    = await db.prepare('SELECT * FROM children WHERE family_id = ?').all(family.id)
    const childStats  = await Promise.all(children.map(async child => {
      const sRow = await db.prepare(`SELECT COUNT(*) as signals FROM signals s JOIN devices d ON d.id=s.device_id WHERE d.child_id=? AND s.created_at > datetime('now','-7 days')`).get(child.id)
      const cRow = await db.prepare(`SELECT COUNT(*) as critical FROM alerts WHERE child_id=? AND level='critical' AND created_at > datetime('now','-7 days')`).get(child.id)
      const wRow = await db.prepare(`SELECT COUNT(*) as warn FROM alerts WHERE child_id=? AND level='warn' AND created_at > datetime('now','-7 days')`).get(child.id)
      return { name: child.name, signals: sRow?.signals ?? 0, critical: cRow?.critical ?? 0, warn: wRow?.warn ?? 0 }
    }))

    const totalSignals = childStats.reduce((s, c) => s + c.signals, 0)
    if (totalSignals === 0) continue

    await sendWeeklyDigest({ parentName: parent.name, parentEmail: parent.email, children: childStats, weekStart, weekEnd })
    sent++
  }

  res.json({ ok: true, sent })
})

export default router
