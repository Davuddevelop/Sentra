import { Router } from 'express'
import crypto from 'crypto'
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
  const limit    = Math.min(parseInt(req.query.limit)  || 20, 100)
  const offset   = parseInt(req.query.offset) || 0
  const days     = Math.min(parseInt(req.query.days) || 30, 30)
  const childId  = req.query.child_id ? parseInt(req.query.child_id) : null
  const level    = req.query.level    || null
  const unreadOnly = req.query.unread === 'true'

  const conditions = ['a.family_id = ?']
  const args       = [req.family.id]

  if (unreadOnly)  { conditions.push('a.read = 0') }
  if (childId)     { conditions.push('a.child_id = ?'); args.push(childId) }
  if (level)       { conditions.push('a.level = ?');    args.push(level) }
  conditions.push(`a.created_at > datetime('now', '-${days} days')`)

  const where = 'WHERE ' + conditions.join(' AND ')

  const alerts = db.prepare(`
    SELECT a.*, c.name AS child_name
    FROM alerts a JOIN children c ON c.id = a.child_id
    ${where}
    ORDER BY a.created_at DESC LIMIT ? OFFSET ?
  `).all(...args, limit, offset)

  const { count } = db
    .prepare('SELECT COUNT(*) as count FROM alerts WHERE family_id = ? AND read = 0')
    .get(req.family.id)

  res.json({ alerts, unread: count })
})

/* ── POST /api/family/device ─────────────────────────────── */
router.post('/family/device', requireAuth, requireFamily, (req, res) => {
  const { child_id, name, platform } = req.body ?? {}
  if (!child_id || !name?.trim()) return res.status(400).json({ error: 'child_id and name are required.' })

  const child = db.prepare('SELECT * FROM children WHERE id = ? AND family_id = ?').get(child_id, req.family.id)
  if (!child) return res.status(403).json({ error: 'Child not found.' })

  const token = crypto.randomBytes(16).toString('hex')

  const { lastInsertRowid: deviceId } = db
    .prepare('INSERT INTO devices (child_id, name, platform, device_token) VALUES (?, ?, ?, ?)')
    .run(child_id, name.trim(), platform || 'browser', token)

  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId)
  res.status(201).json({ ok: true, device })
})

/* ── PATCH /api/alerts/:id/read ──────────────────────────── */
router.patch('/alerts/:id/read', requireAuth, requireFamily, (req, res) => {
  db.prepare('UPDATE alerts SET read = 1 WHERE id = ? AND family_id = ?')
    .run(req.params.id, req.family.id)
  res.json({ ok: true })
})

/* ── GET /api/activity ───────────────────────────────────── */
router.get('/activity', requireAuth, requireFamily, (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 30)
  const childId = req.query.child_id ? parseInt(req.query.child_id) : null
  const level   = req.query.level || null

  const familyFilter = 'a.family_id = ?'
  const childFilter  = childId ? ' AND a.child_id = ?' : ''
  const levelFilter  = level   ? ' AND a.level = ?'   : ''
  const baseArgs     = [req.family.id, ...(childId ? [childId] : []), ...(level ? [level] : [])]

  // Fill all days in range (even days with zero alerts)
  const byDayRaw = db.prepare(`
    SELECT date(a.created_at) as date, COUNT(*) as count,
      SUM(CASE WHEN a.level='critical' THEN 1 ELSE 0 END) as critical,
      SUM(CASE WHEN a.level='warn'     THEN 1 ELSE 0 END) as warn,
      SUM(CASE WHEN a.level='info'     THEN 1 ELSE 0 END) as info
    FROM alerts a
    WHERE ${familyFilter}${childFilter}${levelFilter}
      AND a.created_at > datetime('now', '-${days} days')
    GROUP BY date(a.created_at) ORDER BY date ASC
  `).all(...baseArgs)

  // Build a full date range map
  const dayMap = {}
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    dayMap[key] = { date: key, count: 0, critical: 0, warn: 0, info: 0 }
  }
  byDayRaw.forEach(r => { if (dayMap[r.date]) dayMap[r.date] = r })
  const byDay = Object.values(dayMap)

  const byCategory = db.prepare(`
    SELECT category, COUNT(*) as count
    FROM alerts a WHERE ${familyFilter}${childFilter}${levelFilter}
      AND a.created_at > datetime('now', '-${days} days')
    GROUP BY category ORDER BY count DESC
  `).all(...baseArgs)

  const byLevel = db.prepare(`
    SELECT level, COUNT(*) as count
    FROM alerts a WHERE ${familyFilter}${childFilter}
      AND a.created_at > datetime('now', '-${days} days')
    GROUP BY level ORDER BY count DESC
  `).all(...[req.family.id, ...(childId ? [childId] : [])])

  const byChild = db.prepare(`
    SELECT c.name, c.id, COUNT(a.id) as count,
      SUM(CASE WHEN a.level='critical' THEN 1 ELSE 0 END) as critical,
      SUM(CASE WHEN a.level='warn'     THEN 1 ELSE 0 END) as warn
    FROM alerts a JOIN children c ON c.id = a.child_id
    WHERE a.family_id = ? AND a.created_at > datetime('now', '-${days} days')
    GROUP BY a.child_id ORDER BY count DESC
  `).all(req.family.id)

  res.json({ byDay, byCategory, byLevel, byChild })
})

/* ── GET /api/child/:id ──────────────────────────────────── */
router.get('/child/:id', requireAuth, requireFamily, (req, res) => {
  const child = db.prepare('SELECT * FROM children WHERE id = ? AND family_id = ?')
    .get(req.params.id, req.family.id)
  if (!child) return res.status(404).json({ error: 'Child not found.' })

  const devices = db.prepare('SELECT * FROM devices WHERE child_id = ?').all(child.id)
  const alerts  = db.prepare(`
    SELECT * FROM alerts WHERE child_id = ? ORDER BY created_at DESC LIMIT 20
  `).all(child.id)

  const { signals } = db.prepare(`
    SELECT COUNT(*) as signals FROM signals s
    JOIN devices d ON d.id = s.device_id
    WHERE d.child_id = ? AND s.created_at > datetime('now', '-7 days')
  `).get(child.id)

  const { unread } = db.prepare(
    'SELECT COUNT(*) as unread FROM alerts WHERE child_id = ? AND read = 0'
  ).get(child.id)

  const { maxRisk } = db.prepare(
    'SELECT MAX(risk_score) as maxRisk FROM signals s JOIN devices d ON d.id=s.device_id WHERE d.child_id = ?'
  ).get(child.id)

  res.json({ child, devices, alerts, stats: { signals, unread, maxRisk: maxRisk || 0 } })
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

/* ── POST /api/push/register ─────────────────────────────── */
// Called by parent's mobile device to register their Expo push token
router.post('/push/register', requireAuth, (req, res) => {
  const { push_token } = req.body ?? {}
  if (!push_token) return res.status(400).json({ error: 'push_token required.' })
  db.prepare('UPDATE users SET push_token = ? WHERE id = ?').run(push_token, req.user.id)
  res.json({ ok: true })
})

/* ── DELETE /api/account ─────────────────────────────────── */
router.delete('/account', requireAuth, (req, res) => {
  // Cascade deletes via FK: family → children → devices → signals/alerts
  db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id)
  res.clearCookie('token')
  res.json({ ok: true, message: 'Account and all associated data permanently deleted.' })
})

/* ── GET /api/export ─────────────────────────────────────── */
// GDPR right-to-access: returns all data for this family as JSON
router.get('/export', requireAuth, requireFamily, (req, res) => {
  const children = db.prepare('SELECT id, name, age, created_at FROM children WHERE family_id = ?').all(req.family.id)

  const childrenWithData = children.map(child => {
    const devices = db.prepare('SELECT id, name, platform, last_seen, created_at FROM devices WHERE child_id = ?').all(child.id)
    const alerts  = db.prepare('SELECT level, category, title, body, read, created_at FROM alerts WHERE child_id = ? ORDER BY created_at DESC').all(child.id)
    const signals = db.prepare(`
      SELECT s.type, s.payload, s.risk_score, s.created_at
      FROM signals s JOIN devices d ON d.id = s.device_id
      WHERE d.child_id = ? ORDER BY s.created_at DESC LIMIT 500
    `).all(child.id)
    return { ...child, devices, alerts, signals }
  })

  const exportData = {
    exported_at: new Date().toISOString(),
    account: {
      name:       req.user.name,
      email:      req.user.email,
      plan:       req.user.plan,
      created_at: req.user.created_at,
    },
    family:   { name: req.family.name, created_at: req.family.created_at },
    children: childrenWithData,
  }

  res.setHeader('Content-Disposition', 'attachment; filename="sentra-data-export.json"')
  res.setHeader('Content-Type', 'application/json')
  res.json(exportData)
})

export default router
