import { Router } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import rateLimit from 'express-rate-limit'
import db from '../db/schema.js'
import { sendWelcomeEmail, sendConsentEmail } from '../services/email.js'

const router = Router()

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — try again in 15 minutes.' },
})
const SALT_ROUNDS = 12
const JWT_SECRET = process.env.JWT_SECRET || 'sentra-dev-secret-change-in-prod'
const JWT_EXPIRES = '7d'
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  secure: process.env.NODE_ENV === 'production'
}

const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VALID_PLANS = ['starter', 'family', 'family-plus']

function issueToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES })
}

function safeUser(user) {
  const { password_hash, ...safe } = user
  return safe
}

/* ── POST /api/auth/register ─────────────────────────────── */
router.post('/register', authLimiter, async (req, res) => {
  const { name, email, password, plan } = req.body ?? {}

  if (!name?.trim())                      return res.status(400).json({ error: 'Name is required.' })
  if (!email || !EMAIL_RE.test(email))    return res.status(400).json({ error: 'Valid email is required.' })
  if (!password || password.length < 8)  return res.status(400).json({ error: 'Password must be at least 8 characters.' })

  const chosenPlan = VALID_PLANS.includes(plan) ? plan : 'starter'

  try {
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS)
    const consentToken  = crypto.randomBytes(24).toString('hex')

    const { lastInsertRowid: userId } = await db
      .prepare('INSERT INTO users (name, email, password_hash, plan, consent_token, consent_sent_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)')
      .run(name.trim(), email.toLowerCase().trim(), password_hash, chosenPlan, consentToken)

    const { lastInsertRowid: familyId } = await db
      .prepare('INSERT INTO families (owner_id, name) VALUES (?, ?)')
      .run(userId, `${name.trim()}'s Family`)

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    const sessionToken = issueToken(user)

    setImmediate(() => {
      sendConsentEmail({ name: name.trim(), email: email.toLowerCase().trim(), consentToken })
      sendWelcomeEmail({ name: name.trim(), email: email.toLowerCase().trim() })
    })

    res.cookie('token', sessionToken, COOKIE_OPTS)
    res.status(201).json({ ok: true, user: safeUser(user), familyId, consent_required: true })
  } catch (err) {
    if (err.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'An account with this email already exists.' })
    }
    console.error('[register]', err)
    res.status(500).json({ error: 'Registration failed. Please try again.' })
  }
})

/* ── POST /api/auth/login ────────────────────────────────── */
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body ?? {}

  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' })

  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim())
  if (!user) return res.status(401).json({ error: 'Invalid email or password.' })

  const match = await bcrypt.compare(password, user.password_hash)
  if (!match) return res.status(401).json({ error: 'Invalid email or password.' })

  const token = issueToken(user)
  res.cookie('token', token, COOKIE_OPTS)
  res.json({ ok: true, user: safeUser(user) })
})

/* ── GET /api/auth/verify-consent?token=xxx ─────────────── */
router.get('/verify-consent', async (req, res) => {
  const { token } = req.query
  if (!token) return res.status(400).send('Invalid link.')

  const user = await db.prepare('SELECT * FROM users WHERE consent_token = ?').get(token)
  if (!user) return res.status(404).send('Link expired or already used.')

  await db.prepare('UPDATE users SET consent_verified = 1, consent_token = NULL WHERE id = ?').run(user.id)

  const appUrl = process.env.APP_URL || 'http://localhost:5173'
  res.redirect(`${appUrl}/dashboard.html?consent=verified`)
})

/* ── POST /api/auth/resend-consent ──────────────────────── */
router.post('/resend-consent', async (req, res) => {
  const token = req.cookies?.token
  if (!token) return res.status(401).json({ error: 'Not authenticated.' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id)
    if (!user || user.consent_verified) return res.json({ ok: true })

    const consentToken = crypto.randomBytes(24).toString('hex')
    await db.prepare('UPDATE users SET consent_token = ?, consent_sent_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(consentToken, user.id)
    setImmediate(() => sendConsentEmail({ name: user.name, email: user.email, consentToken }))
    res.json({ ok: true })
  } catch {
    res.status(401).json({ error: 'Session expired.' })
  }
})

/* ── POST /api/auth/logout ───────────────────────────────── */
router.post('/logout', (_req, res) => {
  res.clearCookie('token')
  res.json({ ok: true })
})

/* ── GET /api/auth/me ────────────────────────────────────── */
router.get('/me', async (req, res) => {
  const token = req.cookies?.token
  if (!token) return res.status(401).json({ error: 'Not authenticated.' })

  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id)
    if (!user) return res.status(401).json({ error: 'User not found.' })
    res.json({ user: safeUser(user) })
  } catch {
    res.status(401).json({ error: 'Session expired. Please log in again.' })
  }
})

export default router
