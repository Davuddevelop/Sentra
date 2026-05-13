import { Router } from 'express'
import Stripe from 'stripe'
import db from '../db/schema.js'
import { requireAuth } from '../middleware/auth.js'
import { PLAN_LIMITS } from '../config/plans.js'

const router  = Router()
const stripe  = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder')
const APP_URL = process.env.APP_URL || 'http://localhost:5173'

const PLANS = {
  family:        { priceId: process.env.STRIPE_PRICE_FAMILY      || 'price_family',      name: 'Family',  devices: 5   },
  'family-plus': { priceId: process.env.STRIPE_PRICE_FAMILY_PLUS || 'price_family_plus', name: 'Family+', devices: 999 },
}

/* ── POST /api/billing/checkout ──────────────────────────── */
router.post('/checkout', requireAuth, async (req, res) => {
  const { plan } = req.body ?? {}
  const planConfig = PLANS[plan]
  if (!planConfig) return res.status(400).json({ error: 'Invalid plan.' })

  try {
    let customerId = req.user.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name:  req.user.name,
        metadata: { sentra_user_id: String(req.user.id) },
      })
      customerId = customer.id
      await db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, req.user.id)
    }

    const session = await stripe.checkout.sessions.create({
      customer:   customerId,
      mode:       'subscription',
      line_items: [{ price: planConfig.priceId, quantity: 1 }],
      success_url: `${APP_URL}/dashboard.html?upgraded=1`,
      cancel_url:  `${APP_URL}/dashboard.html`,
      metadata: { sentra_user_id: String(req.user.id), plan },
      subscription_data: { metadata: { sentra_user_id: String(req.user.id), plan } },
    })

    res.json({ url: session.url })
  } catch (err) {
    console.error('[billing] checkout error:', err.message)
    res.status(500).json({ error: 'Could not create checkout session.' })
  }
})

/* ── POST /api/billing/portal ────────────────────────────── */
router.post('/portal', requireAuth, async (req, res) => {
  if (!req.user.stripe_customer_id) {
    return res.status(400).json({ error: 'No active subscription found.' })
  }
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer:   req.user.stripe_customer_id,
      return_url: `${APP_URL}/dashboard.html`,
    })
    res.json({ url: session.url })
  } catch (err) {
    res.status(500).json({ error: 'Could not open billing portal.' })
  }
})

/* ── POST /api/billing/webhook ───────────────────────────── */
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature']
  let event

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[billing] STRIPE_WEBHOOK_SECRET not configured — rejecting webhook')
    return res.status(500).send('Webhook not configured')
  }

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`)
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      const userId  = parseInt(session.metadata?.sentra_user_id)
      const plan    = session.metadata?.plan
      if (userId && plan) {
        await db.prepare('UPDATE users SET plan = ?, plan_status = ?, stripe_sub_id = ? WHERE id = ?')
          .run(plan, 'active', session.subscription, userId)
      }
      break
    }
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused': {
      const sub    = event.data.object
      const userId = parseInt(sub.metadata?.sentra_user_id)
      if (userId) {
        await db.prepare('UPDATE users SET plan = ?, plan_status = ? WHERE id = ?')
          .run('starter', event.type === 'customer.subscription.paused' ? 'paused' : 'cancelled', userId)
      }
      break
    }
    case 'customer.subscription.updated': {
      const sub    = event.data.object
      const userId = parseInt(sub.metadata?.sentra_user_id)
      const plan   = sub.metadata?.plan
      if (userId && plan) {
        await db.prepare('UPDATE users SET plan = ?, plan_status = ? WHERE id = ?')
          .run(plan, sub.status === 'active' ? 'active' : sub.status, userId)
      }
      break
    }
  }

  res.json({ received: true })
})

/* ── GET /api/billing/status ─────────────────────────────── */
router.get('/status', requireAuth, (req, res) => {
  res.json({
    plan:         req.user.plan,
    plan_status:  req.user.plan_status,
    device_limit: PLAN_LIMITS[req.user.plan] ?? 1,
    has_stripe:   !!req.user.stripe_customer_id,
  })
})

export default router
