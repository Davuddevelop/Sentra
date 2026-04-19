import 'dotenv/config'
import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
import db from './src/db/schema.js'
import authRoutes from './src/routes/auth.js'
import dashboardRoutes from './src/routes/dashboard.js'
import signalRoutes from './src/routes/signals.js'
import { startSimulator } from './src/simulator.js'
import { sendWeeklyDigest } from './src/services/email.js'

const app = express()

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:8000'
]

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }))
app.use(express.json())
app.use(cookieParser())

// ─── Public routes ────────────────────────────────────────
const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VALID_PLANS = ['starter', 'family', 'family-plus']

app.post('/api/waitlist', (req, res) => {
  const { email, plan } = req.body ?? {}
  if (!email || !EMAIL_RE.test(email))     return res.status(400).json({ error: 'Please enter a valid email address.' })
  if (plan && !VALID_PLANS.includes(plan)) return res.status(400).json({ error: 'Invalid plan selected.' })

  try {
    db.prepare('INSERT INTO waitlist (email, plan) VALUES (?, ?)').run(
      email.toLowerCase().trim(), plan || 'family'
    )
    const { count } = db.prepare('SELECT COUNT(*) as count FROM waitlist').get()
    res.json({ ok: true, message: "You're on the list!", count })
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'This email is already on the waitlist.' })
    console.error(err)
    res.status(500).json({ error: 'Server error. Please try again.' })
  }
})

app.get('/api/stats', (_req, res) => {
  const { count } = db.prepare('SELECT COUNT(*) as count FROM waitlist').get()
  res.json({ waitlist: count })
})

// ─── Static pages (/privacy, /terms) ─────────────────────
app.get('/privacy', (_req, res) => res.sendFile(join(__dirname, 'public/privacy.html')))
app.get('/terms',   (_req, res) => res.sendFile(join(__dirname, 'public/terms.html')))

// ─── Auth routes (/api/auth/*) ────────────────────────────
app.use('/api/auth', authRoutes)

// ─── Dashboard routes (/api/*) ────────────────────────────
app.use('/api', dashboardRoutes)

// ─── Signal ingestion (/api/signal) ──────────────────────
app.use('/api', signalRoutes)

// ─── 90-day data purge (runs at midnight daily) ───────────────
function runPurge() {
  const { changes: s } = db.prepare("DELETE FROM signals WHERE created_at < datetime('now', '-90 days')").run()
  const { changes: a } = db.prepare("DELETE FROM alerts  WHERE created_at < datetime('now', '-90 days')").run()
  if (s || a) console.log(`[purge] Removed ${s} signals, ${a} alerts older than 90 days`)
}

function scheduleMidnight(fn) {
  const now  = new Date()
  const next = new Date(now); next.setDate(now.getDate() + 1); next.setHours(0, 0, 0, 0)
  const delay = next - now
  setTimeout(() => { fn(); setInterval(fn, 24 * 60 * 60 * 1000) }, delay)
}

// ─── Weekly digest (runs every Sunday at 08:00) ───────────────
function runWeeklyDigest() {
  const families = db.prepare('SELECT * FROM families').all()
  const now = new Date()
  const weekEnd   = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const weekStart = new Date(now - 6 * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  for (const family of families) {
    const parent = db.prepare('SELECT * FROM users WHERE id = ?').get(family.owner_id)
    if (!parent) continue

    const children = db.prepare('SELECT * FROM children WHERE family_id = ?').all(family.id)
    const childStats = children.map(child => {
      const { signals }  = db.prepare(`SELECT COUNT(*) as signals FROM signals s JOIN devices d ON d.id=s.device_id WHERE d.child_id=? AND s.created_at > datetime('now','-7 days')`).get(child.id)
      const { critical } = db.prepare(`SELECT COUNT(*) as critical FROM alerts WHERE child_id=? AND level='critical' AND created_at > datetime('now','-7 days')`).get(child.id)
      const { warn }     = db.prepare(`SELECT COUNT(*) as warn FROM alerts WHERE child_id=? AND level='warn' AND created_at > datetime('now','-7 days')`).get(child.id)
      return { name: child.name, signals, critical, warn }
    })

    const totalSignals = childStats.reduce((s, c) => s + c.signals, 0)
    if (totalSignals === 0) continue // no activity this week, skip email

    sendWeeklyDigest({ parentName: parent.name, parentEmail: parent.email, children: childStats, weekStart, weekEnd })
  }
}

function scheduleWeeklyDigest() {
  const now = new Date()
  // next Sunday 08:00
  const daysUntilSunday = (7 - now.getDay()) % 7 || 7
  const next = new Date(now)
  next.setDate(now.getDate() + daysUntilSunday)
  next.setHours(8, 0, 0, 0)
  const delay = next - now
  setTimeout(() => { runWeeklyDigest(); setInterval(runWeeklyDigest, 7 * 24 * 60 * 60 * 1000) }, delay)
}

const PORT = 3001
app.listen(PORT, () => {
  console.log(`Sentra API → http://localhost:${PORT}`)
  startSimulator()
  scheduleMidnight(runPurge)
  scheduleWeeklyDigest()
  console.log('[jobs] 90-day purge and weekly digest scheduled')
})
