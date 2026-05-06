import 'dotenv/config'
import express from 'express'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

import db from './src/db/schema.js'
import authRoutes     from './src/routes/auth.js'
import dashboardRoutes from './src/routes/dashboard.js'
import signalRoutes   from './src/routes/signals.js'
import billingRoutes  from './src/routes/billing.js'
import cronRoutes     from './src/routes/cron.js'
import { startSimulator } from './src/simulator.js'

const app = express()

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:8000',
  ...(process.env.APP_URL ? [process.env.APP_URL] : []),
]

app.use(compression())
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }))
app.use(express.json({ limit: '50kb' }))
app.use(cookieParser())

// ─── Public routes ────────────────────────────────────────
const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VALID_PLANS = ['starter', 'family', 'family-plus']

app.post('/api/waitlist', async (req, res) => {
  const { email, plan } = req.body ?? {}
  if (!email || !EMAIL_RE.test(email))     return res.status(400).json({ error: 'Please enter a valid email address.' })
  if (plan && !VALID_PLANS.includes(plan)) return res.status(400).json({ error: 'Invalid plan selected.' })

  try {
    await db.prepare('INSERT INTO waitlist (email, plan) VALUES (?, ?)').run(
      email.toLowerCase().trim(), plan || 'family'
    )
    const row = await db.prepare('SELECT COUNT(*) as count FROM waitlist').get()
    res.json({ ok: true, message: "You're on the list!", count: row?.count ?? 0 })
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'This email is already on the waitlist.' })
    console.error(err)
    res.status(500).json({ error: 'Server error. Please try again.' })
  }
})

app.get('/api/stats', async (_req, res) => {
  const row = await db.prepare('SELECT COUNT(*) as count FROM waitlist').get()
  res.json({ waitlist: row?.count ?? 0 })
})

// ─── Static pages (/privacy, /terms) ─────────────────────
app.get('/privacy', (_req, res) => res.sendFile(join(__dirname, 'public/privacy.html')))
app.get('/terms',   (_req, res) => res.sendFile(join(__dirname, 'public/terms.html')))

// ─── API routes ───────────────────────────────────────────
app.use('/api/auth',    authRoutes)
app.use('/api',         dashboardRoutes)
app.use('/api',         signalRoutes)
app.use('/api/billing', billingRoutes)
app.use('/api/cron',    cronRoutes)

// ─── Static frontend (local dev / Railway) ───────────────
app.use(express.static(join(__dirname, 'public')))
app.use(express.static(join(__dirname, 'dist')))
app.get(/^(?!\/api).*$/, (_req, res) => {
  res.sendFile(join(__dirname, 'dist/index.html'))
})

// ─── Start server (skip on Vercel — it handles this) ─────
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3001
  app.listen(PORT, async () => {
    console.log(`Sentra API → http://localhost:${PORT}`)
    await startSimulator()
    if (process.env.NODE_ENV !== 'production') {
      console.log('[jobs] background jobs running in-process')
    }
  })
}

export default app
