import { Router } from 'express'
import crypto from 'crypto'
import { requireAuth, requireFamily } from '../middleware/auth.js'
import db from '../db/schema.js'
import { PLAN_LIMITS } from '../config/plans.js'

const router = Router()

/* ── GET /api/family ─────────────────────────────────────── */
router.get('/family', requireAuth, requireFamily, async (req, res) => {
  const children = await db
    .prepare('SELECT * FROM children WHERE family_id = ? ORDER BY name')
    .all(req.family.id)

  const childrenWithDevices = await Promise.all(children.map(async child => ({
    ...child,
    devices: await db.prepare('SELECT * FROM devices WHERE child_id = ?').all(child.id)
  })))

  res.json({ family: req.family, children: childrenWithDevices })
})

/* ── POST /api/family/child ──────────────────────────────── */
router.post('/family/child', requireAuth, requireFamily, async (req, res) => {
  const { name, age } = req.body ?? {}
  if (!name?.trim()) return res.status(400).json({ error: 'Child name is required.' })

  const { lastInsertRowid: childId } = await db
    .prepare('INSERT INTO children (family_id, name, age) VALUES (?, ?, ?)')
    .run(req.family.id, name.trim(), age ? parseInt(age) : null)

  const child = await db.prepare('SELECT * FROM children WHERE id = ?').get(childId)
  res.status(201).json({ ok: true, child })
})

/* ── GET /api/alerts ─────────────────────────────────────── */
router.get('/alerts', requireAuth, requireFamily, async (req, res) => {
  const limit      = Math.min(parseInt(req.query.limit)  || 20, 100)
  const offset     = parseInt(req.query.offset) || 0
  const days       = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 30)
  const childId    = req.query.child_id ? parseInt(req.query.child_id) : null
  const VALID_LEVELS = ['critical', 'warn', 'info', 'ok']
  const level      = VALID_LEVELS.includes(req.query.level) ? req.query.level : null
  const unreadOnly = req.query.unread === 'true'

  const cutoff     = new Date(Date.now() - days * 86400 * 1000).toISOString()
  const conditions = ['a.family_id = ?']
  const args       = [req.family.id]

  if (unreadOnly) { conditions.push('a.read = 0') }
  if (childId)    { conditions.push('a.child_id = ?'); args.push(childId) }
  if (level)      { conditions.push('a.level = ?');    args.push(level) }
  conditions.push('a.created_at > ?'); args.push(cutoff)

  const where = 'WHERE ' + conditions.join(' AND ')

  const alerts = await db.prepare(`
    SELECT a.*, c.name AS child_name
    FROM alerts a JOIN children c ON c.id = a.child_id
    ${where}
    ORDER BY a.created_at DESC LIMIT ? OFFSET ?
  `).all(...args, limit, offset)

  const unreadRow = await db
    .prepare('SELECT COUNT(*) as count FROM alerts WHERE family_id = ? AND read = 0')
    .get(req.family.id)

  res.json({ alerts, unread: unreadRow?.count ?? 0 })
})

/* ── POST /api/family/device ─────────────────────────────── */
router.post('/family/device', requireAuth, requireFamily, async (req, res) => {
  const { child_id, name, platform } = req.body ?? {}
  if (!child_id || !name?.trim()) return res.status(400).json({ error: 'child_id and name are required.' })

  const child = await db.prepare('SELECT * FROM children WHERE id = ? AND family_id = ?').get(child_id, req.family.id)
  if (!child) return res.status(403).json({ error: 'Child not found.' })

  const limit = PLAN_LIMITS[req.user.plan] ?? 1
  const countRow = await db.prepare(`
    SELECT COUNT(*) as count FROM devices
    JOIN children ON children.id = devices.child_id
    WHERE children.family_id = ?
  `).get(req.family.id)
  if ((countRow?.count ?? 0) >= limit) {
    return res.status(403).json({
      error: `Your ${req.user.plan} plan allows up to ${limit} device${limit === 1 ? '' : 's'}. Upgrade to add more.`,
      upgrade_required: true,
    })
  }

  const token = crypto.randomBytes(16).toString('hex')

  const { lastInsertRowid: deviceId } = await db
    .prepare('INSERT INTO devices (child_id, name, platform, device_token) VALUES (?, ?, ?, ?)')
    .run(child_id, name.trim(), platform || 'browser', token)

  const device = await db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId)
  res.status(201).json({ ok: true, device })
})

/* ── PATCH /api/alerts/:id/read ──────────────────────────── */
router.patch('/alerts/:id/read', requireAuth, requireFamily, async (req, res) => {
  await db.prepare('UPDATE alerts SET read = 1 WHERE id = ? AND family_id = ?')
    .run(req.params.id, req.family.id)
  res.json({ ok: true })
})

/* ── GET /api/activity ───────────────────────────────────── */
router.get('/activity', requireAuth, requireFamily, async (req, res) => {
  const days    = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 30)
  const childId = req.query.child_id ? parseInt(req.query.child_id) : null
  const VALID_LEVELS = ['critical', 'warn', 'info', 'ok']
  const level   = VALID_LEVELS.includes(req.query.level) ? req.query.level : null

  // Compute cutoff in JS so it goes through a parameterized ? — no template literal SQL
  const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString()

  const familyFilter = 'a.family_id = ?'
  const childFilter  = childId ? ' AND a.child_id = ?' : ''
  const levelFilter  = level   ? ' AND a.level = ?'   : ''
  const baseArgs     = [req.family.id, ...(childId ? [childId] : []), ...(level ? [level] : []), cutoff]

  const byDayRaw = await db.prepare(`
    SELECT date(a.created_at) as date, COUNT(*) as count,
      SUM(CASE WHEN a.level='critical' THEN 1 ELSE 0 END) as critical,
      SUM(CASE WHEN a.level='warn'     THEN 1 ELSE 0 END) as warn,
      SUM(CASE WHEN a.level='info'     THEN 1 ELSE 0 END) as info
    FROM alerts a
    WHERE ${familyFilter}${childFilter}${levelFilter}
      AND a.created_at > ?
    GROUP BY date(a.created_at) ORDER BY date ASC
  `).all(...baseArgs)

  const dayMap = {}
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    dayMap[key] = { date: key, count: 0, critical: 0, warn: 0, info: 0 }
  }
  byDayRaw.forEach(r => { if (dayMap[r.date]) dayMap[r.date] = r })
  const byDay = Object.values(dayMap)

  const byCategory = await db.prepare(`
    SELECT category, COUNT(*) as count
    FROM alerts a WHERE ${familyFilter}${childFilter}${levelFilter}
      AND a.created_at > ?
    GROUP BY category ORDER BY count DESC
  `).all(...baseArgs)

  const byLevelArgs = [req.family.id, ...(childId ? [childId] : []), cutoff]
  const byLevel = await db.prepare(`
    SELECT level, COUNT(*) as count
    FROM alerts a WHERE ${familyFilter}${childFilter}
      AND a.created_at > ?
    GROUP BY level ORDER BY count DESC
  `).all(...byLevelArgs)

  const byChild = await db.prepare(`
    SELECT c.name, c.id, COUNT(a.id) as count,
      SUM(CASE WHEN a.level='critical' THEN 1 ELSE 0 END) as critical,
      SUM(CASE WHEN a.level='warn'     THEN 1 ELSE 0 END) as warn
    FROM alerts a JOIN children c ON c.id = a.child_id
    WHERE a.family_id = ? AND a.created_at > ?
    GROUP BY a.child_id ORDER BY count DESC
  `).all(req.family.id, cutoff)

  res.json({ byDay, byCategory, byLevel, byChild })
})

/* ── GET /api/child/:id ──────────────────────────────────── */
router.get('/child/:id', requireAuth, requireFamily, async (req, res) => {
  const child = await db.prepare('SELECT * FROM children WHERE id = ? AND family_id = ?')
    .get(req.params.id, req.family.id)
  if (!child) return res.status(404).json({ error: 'Child not found.' })

  const devices = await db.prepare('SELECT * FROM devices WHERE child_id = ?').all(child.id)
  const alerts  = await db.prepare(
    'SELECT * FROM alerts WHERE child_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(child.id)

  const signalRow = await db.prepare(`
    SELECT COUNT(*) as signals FROM signals s
    JOIN devices d ON d.id = s.device_id
    WHERE d.child_id = ? AND s.created_at > datetime('now', '-7 days')
  `).get(child.id)

  const unreadRow = await db.prepare(
    'SELECT COUNT(*) as unread FROM alerts WHERE child_id = ? AND read = 0'
  ).get(child.id)

  const riskRow = await db.prepare(
    'SELECT MAX(risk_score) as maxRisk FROM signals s JOIN devices d ON d.id=s.device_id WHERE d.child_id = ?'
  ).get(child.id)

  res.json({
    child, devices, alerts,
    stats: {
      signals: signalRow?.signals ?? 0,
      unread:  unreadRow?.unread  ?? 0,
      maxRisk: riskRow?.maxRisk   ?? 0,
    },
  })
})

/* ── GET /api/stats ──────────────────────────────────────── */
router.get('/stats', requireAuth, requireFamily, async (req, res) => {
  const childrenRow = await db.prepare('SELECT COUNT(*) as children FROM children WHERE family_id = ?').get(req.family.id)
  const devicesRow  = await db.prepare(`
    SELECT COUNT(*) as devices FROM devices d
    JOIN children c ON c.id = d.child_id WHERE c.family_id = ?
  `).get(req.family.id)
  const alertsRow   = await db.prepare('SELECT COUNT(*) as alerts FROM alerts WHERE family_id = ? AND read = 0').get(req.family.id)
  const signalsRow  = await db.prepare(`
    SELECT COUNT(*) as signals FROM signals s
    JOIN devices d ON d.id = s.device_id
    JOIN children c ON c.id = d.child_id
    WHERE c.family_id = ? AND s.created_at > datetime('now', '-7 days')
  `).get(req.family.id)

  res.json({
    children:       childrenRow?.children  ?? 0,
    devices:        devicesRow?.devices    ?? 0,
    unreadAlerts:   alertsRow?.alerts      ?? 0,
    signalsThisWeek: signalsRow?.signals   ?? 0,
  })
})

/* ── POST /api/push/register ─────────────────────────────── */
router.post('/push/register', requireAuth, async (req, res) => {
  const { push_token } = req.body ?? {}
  if (!push_token) return res.status(400).json({ error: 'push_token required.' })
  await db.prepare('UPDATE users SET push_token = ? WHERE id = ?').run(push_token, req.user.id)
  res.json({ ok: true })
})

/* ── POST /api/family/co-owner ───────────────────────────── */
router.post('/family/co-owner', requireAuth, requireFamily, async (req, res) => {
  if (req.family.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the family owner can add a co-parent.' })
  }
  const { email } = req.body ?? {}
  if (!email) return res.status(400).json({ error: 'email is required.' })

  const target = await db.prepare('SELECT id, name, email FROM users WHERE email = ?').get(email.toLowerCase().trim())
  if (!target) return res.status(404).json({ error: 'No Sentra account found with that email.' })
  if (target.id === req.user.id) return res.status(400).json({ error: 'That is your own account.' })

  await db.prepare('UPDATE families SET co_owner_id = ? WHERE id = ?').run(target.id, req.family.id)
  res.json({ ok: true, co_owner: { id: target.id, name: target.name, email: target.email } })
})

/* ── DELETE /api/family/co-owner ─────────────────────────── */
router.delete('/family/co-owner', requireAuth, requireFamily, async (req, res) => {
  if (req.family.owner_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the family owner can remove a co-parent.' })
  }
  await db.prepare('UPDATE families SET co_owner_id = NULL WHERE id = ?').run(req.family.id)
  res.json({ ok: true })
})

/* ── DELETE /api/account ─────────────────────────────────── */
router.delete('/account', requireAuth, async (req, res) => {
  await db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id)
  res.clearCookie('token')
  res.json({ ok: true, message: 'Account and all associated data permanently deleted.' })
})

/* ── GET /api/export ─────────────────────────────────────── */
router.get('/export', requireAuth, requireFamily, async (req, res) => {
  const children = await db.prepare('SELECT id, name, age, created_at FROM children WHERE family_id = ?').all(req.family.id)

  const childrenWithData = await Promise.all(children.map(async child => {
    const devices = await db.prepare('SELECT id, name, platform, last_seen, created_at FROM devices WHERE child_id = ?').all(child.id)
    const alerts  = await db.prepare('SELECT level, category, title, body, read, created_at FROM alerts WHERE child_id = ? ORDER BY created_at DESC').all(child.id)
    const signals = await db.prepare(`
      SELECT s.type, s.payload, s.risk_score, s.created_at
      FROM signals s JOIN devices d ON d.id = s.device_id
      WHERE d.child_id = ? ORDER BY s.created_at DESC LIMIT 500
    `).all(child.id)
    return { ...child, devices, alerts, signals }
  }))

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
