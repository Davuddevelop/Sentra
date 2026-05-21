import { Router } from 'express'
import crypto from 'crypto'
import rateLimit from 'express-rate-limit'
import { requireAuth, requireFamily } from '../middleware/auth.js'
import db from '../db/schema.js'
import { PLAN_LIMITS } from '../config/plans.js'
import { sendInstallLinkEmail } from '../services/email.js'

const installTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: req => req.params.token || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests.' },
})

const router = Router()

/* ── GET /api/family ─────────────────────────────────────── */
router.get('/family', requireAuth, requireFamily, async (req, res) => {
  // Single JOIN replaces N+1 (1 + N device queries)
  const rows = await db.prepare(`
    SELECT c.id, c.name, c.age, c.avatar, c.created_at,
           d.id as dev_id, d.name as dev_name, d.platform, d.device_token, d.last_seen
    FROM children c
    LEFT JOIN devices d ON d.child_id = c.id
    WHERE c.family_id = ? ORDER BY c.name, d.id
  `).all(req.family.id)

  const childMap = new Map()
  for (const r of rows) {
    if (!childMap.has(r.id)) {
      childMap.set(r.id, { id: r.id, name: r.name, age: r.age, avatar: r.avatar, created_at: r.created_at, devices: [] })
    }
    if (r.dev_id) {
      childMap.get(r.id).devices.push({ id: r.dev_id, name: r.dev_name, platform: r.platform, device_token: r.device_token, last_seen: r.last_seen })
    }
  }

  res.json({ family: req.family, children: [...childMap.values()] })
})

/* ── POST /api/family/child ──────────────────────────────── */
router.post('/family/child', requireAuth, requireFamily, async (req, res) => {
  const { name, age } = req.body ?? {}
  if (!name?.trim()) return res.status(400).json({ error: 'Child name is required.' })

  const { lastInsertRowid: childId } = await db
    .prepare('INSERT INTO children (family_id, name, age) VALUES (?, ?, ?)')
    .run(req.family.id, name.trim(), age ? parseInt(age, 10) : null)

  const child = await db.prepare('SELECT * FROM children WHERE id = ?').get(childId)
  res.status(201).json({ ok: true, child })
})

/* ── GET /api/alerts ─────────────────────────────────────── */
router.get('/alerts', requireAuth, requireFamily, async (req, res) => {
  const limit      = Math.min(parseInt(req.query.limit,  10) || 20, 100)
  const offset     = parseInt(req.query.offset, 10) || 0
  const days       = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 30)
  const childId    = req.query.child_id ? parseInt(req.query.child_id, 10) : null
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

/* ── POST /api/family/install-link ──────────────────────────────────────── */
router.post('/family/install-link', requireAuth, requireFamily, async (req, res) => {
  const { device_id } = req.body ?? {}
  if (!device_id) return res.status(400).json({ error: 'device_id is required.' })

  const device = await db.prepare(`
    SELECT d.id, d.name, d.device_token, c.name as child_name
    FROM devices d
    JOIN children c ON c.id = d.child_id
    WHERE d.id = ? AND c.family_id = ?
  `).get(device_id, req.family.id)
  if (!device) return res.status(403).json({ error: 'Device not found.' })

  const token = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  await db.prepare('INSERT INTO install_tokens (token, device_id, expires_at) VALUES (?, ?, ?)').run(token, device.id, expiresAt)

  const base = process.env.APP_URL || 'https://sentra-peach-delta.vercel.app'
  res.json({ ok: true, url: `${base}/install/${token}` })
})

/* ── POST /api/family/send-install-email ─────────────────── */
router.post('/family/send-install-email', requireAuth, requireFamily, async (req, res) => {
  const { device_id, email } = req.body ?? {}
  if (!device_id || !email?.trim()) return res.status(400).json({ error: 'device_id and email are required.' })

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email.trim())) return res.status(400).json({ error: 'Invalid email address.' })

  const device = await db.prepare(`
    SELECT d.id, d.name, d.device_token, c.name as child_name
    FROM devices d
    JOIN children c ON c.id = d.child_id
    WHERE d.id = ? AND c.family_id = ?
  `).get(device_id, req.family.id)
  if (!device) return res.status(403).json({ error: 'Device not found.' })

  const token = crypto.randomBytes(24).toString('hex')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  await db.prepare('INSERT INTO install_tokens (token, device_id, expires_at) VALUES (?, ?, ?)').run(token, device.id, expiresAt)

  const base = process.env.APP_URL || 'https://sentra-peach-delta.vercel.app'
  const installUrl = `${base}/install/${token}`

  setImmediate(() => sendInstallLinkEmail({
    parentEmail: email.trim(),
    childName: device.child_name,
    deviceName: device.name,
    installUrl,
  }))

  res.json({ ok: true })
})

/* ── GET /api/install/:token ─────────────────────────────── */
router.get('/install/:token', installTokenLimiter, async (req, res) => {
  const row = await db.prepare(`
    SELECT it.token, d.device_token, d.name as device_name, c.name as child_name
    FROM install_tokens it
    JOIN devices d ON d.id = it.device_id
    JOIN children c ON c.id = d.child_id
    WHERE it.token = ? AND it.expires_at > datetime('now')
  `).get(req.params.token)
  if (!row) return res.status(404).json({ error: 'Install link expired or not found.' })
  res.json({ device_token: row.device_token, device_name: row.device_name, child_name: row.child_name })
})

/* ── PATCH /api/alerts/:id/read ──────────────────────────── */
router.patch('/alerts/:id/read', requireAuth, requireFamily, async (req, res) => {
  await db.prepare('UPDATE alerts SET read = 1 WHERE id = ? AND family_id = ?')
    .run(req.params.id, req.family.id)
  res.json({ ok: true })
})

/* ── GET /api/activity ───────────────────────────────────── */
router.get('/activity', requireAuth, requireFamily, async (req, res) => {
  const days    = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 30)
  const childId = req.query.child_id ? parseInt(req.query.child_id, 10) : null
  const VALID_LEVELS = ['critical', 'warn', 'info', 'ok']
  const level   = VALID_LEVELS.includes(req.query.level) ? req.query.level : null

  // Compute cutoff in JS so it goes through a parameterized ? — no template literal SQL
  const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString()

  const familyFilter = 'a.family_id = ?'
  const childFilter  = childId ? ' AND a.child_id = ?' : ''
  const levelFilter  = level   ? ' AND a.level = ?'   : ''
  const baseArgs     = [req.family.id, ...(childId ? [childId] : []), ...(level ? [level] : []), cutoff]

  // Run all 4 analytics queries in parallel — they're independent
  const byLevelArgs = [req.family.id, ...(childId ? [childId] : []), cutoff]
  const [byDayRaw, byCategory, byLevel, byChild] = await Promise.all([
    db.prepare(`
      SELECT date(a.created_at) as date, COUNT(*) as count,
        SUM(CASE WHEN a.level='critical' THEN 1 ELSE 0 END) as critical,
        SUM(CASE WHEN a.level='warn'     THEN 1 ELSE 0 END) as warn,
        SUM(CASE WHEN a.level='info'     THEN 1 ELSE 0 END) as info
      FROM alerts a
      WHERE ${familyFilter}${childFilter}${levelFilter}
        AND a.created_at > ?
      GROUP BY date(a.created_at) ORDER BY date ASC
    `).all(...baseArgs),
    db.prepare(`
      SELECT category, COUNT(*) as count
      FROM alerts a WHERE ${familyFilter}${childFilter}${levelFilter}
        AND a.created_at > ?
      GROUP BY category ORDER BY count DESC
    `).all(...baseArgs),
    db.prepare(`
      SELECT level, COUNT(*) as count
      FROM alerts a WHERE ${familyFilter}${childFilter}
        AND a.created_at > ?
      GROUP BY level ORDER BY count DESC
    `).all(...byLevelArgs),
    db.prepare(`
      SELECT c.name, c.id, COUNT(a.id) as count,
        SUM(CASE WHEN a.level='critical' THEN 1 ELSE 0 END) as critical,
        SUM(CASE WHEN a.level='warn'     THEN 1 ELSE 0 END) as warn
      FROM alerts a JOIN children c ON c.id = a.child_id
      WHERE a.family_id = ? AND a.created_at > ?
      GROUP BY a.child_id ORDER BY count DESC
    `).all(req.family.id, cutoff),
  ])

  const dayMap = {}
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    dayMap[key] = { date: key, count: 0, critical: 0, warn: 0, info: 0 }
  }
  byDayRaw.forEach(r => { if (dayMap[r.date]) dayMap[r.date] = r })
  const byDay = Object.values(dayMap)

  res.json({ byDay, byCategory, byLevel, byChild })
})

/* ── GET /api/child/:id ──────────────────────────────────── */
router.get('/child/:id', requireAuth, requireFamily, async (req, res) => {
  const child = await db.prepare('SELECT * FROM children WHERE id = ? AND family_id = ?')
    .get(req.params.id, req.family.id)
  if (!child) return res.status(404).json({ error: 'Child not found.' })

  // Run all child-detail queries in parallel — they're independent
  const [devices, alerts, signalRow, unreadRow, riskRow] = await Promise.all([
    db.prepare('SELECT * FROM devices WHERE child_id = ?').all(child.id),
    db.prepare('SELECT * FROM alerts WHERE child_id = ? ORDER BY created_at DESC LIMIT 20').all(child.id),
    db.prepare(`
      SELECT COUNT(*) as signals FROM signals s
      JOIN devices d ON d.id = s.device_id
      WHERE d.child_id = ? AND s.created_at > datetime('now', '-7 days')
    `).get(child.id),
    db.prepare('SELECT COUNT(*) as unread FROM alerts WHERE child_id = ? AND read = 0').get(child.id),
    db.prepare('SELECT MAX(risk_score) as maxRisk FROM signals s JOIN devices d ON d.id=s.device_id WHERE d.child_id = ?').get(child.id),
  ])

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
// Accepts either JWT auth (web) or X-Device-Token header (mobile child device → look up parent)
router.post('/push/register', async (req, res) => {
  const { push_token } = req.body ?? {}
  if (!push_token || !push_token.startsWith('ExponentPushToken')) {
    return res.status(400).json({ error: 'Valid Expo push_token required.' })
  }

  const deviceToken = req.headers['x-device-token']
  if (deviceToken) {
    // Mobile path: look up parent owner via device token
    const row = await db.prepare(`
      SELECT u.id FROM devices d
      JOIN children c ON c.id = d.child_id
      JOIN families f ON f.id = c.family_id
      JOIN users    u ON u.id = f.owner_id
      WHERE d.device_token = ?
    `).get(deviceToken)
    if (!row) return res.status(401).json({ error: 'Unknown device.' })
    await db.prepare('UPDATE users SET push_token = ? WHERE id = ?').run(push_token, row.id)
    return res.json({ ok: true })
  }

  // Web path: require JWT
  const cookieToken = req.cookies?.token
  if (!cookieToken) return res.status(401).json({ error: 'Authentication required.' })
  try {
    const jwt = await import('jsonwebtoken')
    const JWT_SECRET = process.env.JWT_SECRET
    const payload = jwt.default.verify(cookieToken, JWT_SECRET, { algorithms: ['HS256'] })
    await db.prepare('UPDATE users SET push_token = ? WHERE id = ?').run(push_token, payload.id)
    res.json({ ok: true })
  } catch {
    res.status(401).json({ error: 'Session expired.' })
  }
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
  // Three bulk queries replace N*3 individual queries
  const [children, allDevices, allAlerts, allSignals] = await Promise.all([
    db.prepare('SELECT id, name, age, created_at FROM children WHERE family_id = ?').all(req.family.id),
    db.prepare('SELECT id, child_id, name, platform, last_seen, created_at FROM devices WHERE child_id IN (SELECT id FROM children WHERE family_id = ?)').all(req.family.id),
    db.prepare('SELECT child_id, level, category, title, body, read, created_at FROM alerts WHERE family_id = ? ORDER BY created_at DESC LIMIT 500').all(req.family.id),
    db.prepare(`
      SELECT d.child_id, s.type, s.payload, s.risk_score, s.created_at
      FROM signals s JOIN devices d ON d.id = s.device_id
      JOIN children c ON c.id = d.child_id
      WHERE c.family_id = ? ORDER BY s.created_at DESC LIMIT 500
    `).all(req.family.id),
  ])

  const devsByChild = {}; for (const d of allDevices) { (devsByChild[d.child_id] ??= []).push(d) }
  const alertsByChild = {}; for (const a of allAlerts) { (alertsByChild[a.child_id] ??= []).push(a) }
  const signalsByChild = {}; for (const s of allSignals) { (signalsByChild[s.child_id] ??= []).push(s) }

  const childrenWithData = children.map(child => ({
    ...child,
    devices: devsByChild[child.id] ?? [],
    alerts:  alertsByChild[child.id] ?? [],
    signals: signalsByChild[child.id] ?? [],
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
