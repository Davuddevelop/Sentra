import 'dotenv/config'
import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import db from './src/db/schema.js'
import authRoutes from './src/routes/auth.js'
import dashboardRoutes from './src/routes/dashboard.js'
import signalRoutes from './src/routes/signals.js'
import { startSimulator } from './src/simulator.js'

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

// ─── Auth routes (/api/auth/*) ────────────────────────────
app.use('/api/auth', authRoutes)

// ─── Dashboard routes (/api/*) ────────────────────────────
app.use('/api', dashboardRoutes)

// ─── Signal ingestion (/api/signal) ──────────────────────
app.use('/api', signalRoutes)

const PORT = 3001
app.listen(PORT, () => {
  console.log(`Sentra API → http://localhost:${PORT}`)
  startSimulator()
})
