import { Router } from 'express'
import { requireAuth, requireFamily } from '../middleware/auth.js'
import db from '../db/schema.js'

const router = Router()

/* ── GET /api/family ─────────────────────────────────────── */
router.get('/family', requireAuth, requireFamily, (req, res) => {
  const children = db
    .prepare('SELECT * FROM children WHERE family_id = ? ORDER BY name')
    .all(req.family.id)

  const childrenWithDevices = children.map(child => ({
    ...child,
    devices: db.prepare('SELECT * FROM devices WHERE child_id = ?').all(child.id)
  }))

  res.json({ family: req.family, children: childrenWithDevices })
})

/* ── POST /api/family/child ──────────────────────────────── */
router.post('/family/child', requireAuth, requireFamily, (req, res) => {
  const { name, age } = req.body ?? {}
  if (!name?.trim()) return res.status(400).json({ error: 'Child name is required.' })

  const { lastInsertRowid: childId } = db
    .prepare('INSERT INTO children (family_id, name, age) VALUES (?, ?, ?)')
    .run(req.family.id, name.trim(), age ? parseInt(age) : null)

  const child = db.prepare('SELECT * FROM children WHERE id = ?').get(childId)
  res.status(201).json({ ok: true, child })
})

/* ── GET /api/alerts ─────────────────────────────────────── */
router.get('/alerts', requireAuth, requireFamily, (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 20, 100)
  const offset = parseInt(req.query.offset) || 0
  const unreadOnly = req.query.unread === 'true'

  const where = unreadOnly ? 'WHERE a.family_id = ? AND a.read = 0' : 'WHERE a.family_id = ?'

  const alerts = db.prepare(`
    SELECT a.*, c.name AS child_name
    FROM alerts a
    JOIN children c ON c.id = a.child_id
    ${where}
    ORDER BY a.created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.family.id, limit, offset)

  const { count } = db
    .prepare('SELECT COUNT(*) as count FROM alerts WHERE family_id = ? AND read = 0')
    .get(req.family.id)

  res.json({ alerts, unread: count })
})

/* ── PATCH /api/alerts/:id/read ──────────────────────────── */
router.patch('/alerts/:id/read', requireAuth, requireFamily, (req, res) => {
  db.prepare('UPDATE alerts SET read = 1 WHERE id = ? AND family_id = ?')
    .run(req.params.id, req.family.id)
  res.json({ ok: true })
})

/* ── GET /api/stats ──────────────────────────────────────── */
router.get('/stats', requireAuth, requireFamily, (req, res) => {
  const { children }  = db.prepare('SELECT COUNT(*) as children FROM children WHERE family_id = ?').get(req.family.id)
  const { devices }   = db.prepare(`
    SELECT COUNT(*) as devices FROM devices d
    JOIN children c ON c.id = d.child_id WHERE c.family_id = ?
  `).get(req.family.id)
  const { alerts }    = db.prepare('SELECT COUNT(*) as alerts FROM alerts WHERE family_id = ? AND read = 0').get(req.family.id)
  const { signals }   = db.prepare(`
    SELECT COUNT(*) as signals FROM signals s
    JOIN devices d ON d.id = s.device_id
    JOIN children c ON c.id = d.child_id
    WHERE c.family_id = ? AND s.created_at > datetime('now', '-7 days')
  `).get(req.family.id)

  res.json({ children, devices, unreadAlerts: alerts, signalsThisWeek: signals })
})

export default router
