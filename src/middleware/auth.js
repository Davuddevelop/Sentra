import jwt from 'jsonwebtoken'
import db from '../db/schema.js'

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error('JWT_SECRET env var is required — set it in .env or Vercel dashboard')

export async function requireAuth(req, res, next) {
  const token = req.cookies?.token
  if (!token) return res.status(401).json({ error: 'Authentication required.' })

  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] })
    const user = await db.prepare('SELECT id, email, name, plan, plan_status, stripe_customer_id, push_token, created_at FROM users WHERE id = ?').get(payload.id)
    if (!user) return res.status(401).json({ error: 'User not found.' })
    req.user = user
    next()
  } catch (err) {
    if (err.name !== 'JsonWebTokenError' && err.name !== 'TokenExpiredError') {
      console.error('[auth]', err.message)
    }
    res.status(401).json({ error: 'Session expired. Please log in again.' })
  }
}

export async function requireFamily(req, res, next) {
  const family = await db
    .prepare('SELECT * FROM families WHERE owner_id = ? OR co_owner_id = ?')
    .get(req.user.id, req.user.id)
  if (!family) return res.status(404).json({ error: 'Family not found.' })
  req.family = family
  next()
}
