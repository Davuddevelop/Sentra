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
  ...(process.env.NODE_ENV !== 'production'
    ? ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:3001', 'http://localhost:8000']
    : []),
  ...(process.env.APP_URL ? [process.env.APP_URL] : []),
]

const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')

app.use(compression())
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https://sentra-peach-delta.vercel.app https://api.qrserver.com")
  next()
})
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }))
// Must be before express.json() — Stripe needs raw body for signature verification
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }))
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

// ─── Install landing page ─────────────────────────────────
app.get('/install/:token', async (req, res) => {
  const row = await db.prepare(`
    SELECT it.token, d.device_token, d.name as device_name, c.name as child_name
    FROM install_tokens it
    JOIN devices d ON d.id = it.device_id
    JOIN children c ON c.id = d.child_id
    WHERE it.token = ? AND it.expires_at > datetime('now')
  `).get(req.params.token)

  if (!row) {
    return res.status(410).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Link expired — Sentra</title>
    <style>body{font-family:Inter,sans-serif;background:#F3EDDD;color:#1A2A22;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .box{text-align:center;max-width:400px;padding:40px 20px}h1{font-size:28px;margin-bottom:12px}p{color:#3C4A42;line-height:1.6}</style></head>
    <body><div class="box"><div style="font-size:48px;margin-bottom:20px">⏱</div>
    <h1>Link expired</h1><p>This install link is no longer valid. Go back to your Sentra dashboard and generate a new one.</p>
    <a href="https://sentra-peach-delta.vercel.app/dashboard.html" style="display:inline-block;margin-top:24px;padding:12px 28px;background:#1A2A22;color:#F8F4E8;border-radius:100px;text-decoration:none;font-size:14px">Open Dashboard</a>
    </div></body></html>`)
  }

  const { device_token, device_name, child_name } = row
  const eChildName  = esc(child_name)
  const eDeviceName = esc(device_name)
  const eToken      = esc(device_token)
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect ${eChildName}'s browser — Sentra</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;1,9..144,300&family=Inter:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --cream: #F3EDDD; --ink: #1A2A22; --ink-soft: #3C4A42;
      --moss: #2C5A3F; --moss-deep: #1B3A27; --moss-light: #D9E5D1;
      --terra: #C85A2E; --paper: #FBF7EB; --line: rgba(26,42,34,0.14);
    }
    body { font-family: Inter, sans-serif; background: var(--cream); color: var(--ink); min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 20px; }
    .logo { font-family: Fraunces, serif; font-size: 22px; font-weight: 400; color: var(--ink); margin-bottom: 48px; display: flex; align-items: center; gap: 10px; }
    .logo-dot { width: 8px; height: 8px; background: var(--terra); border-radius: 50%; }
    .card { background: var(--paper); border-radius: 24px; border: 0.5px solid var(--line); padding: 40px; max-width: 480px; width: 100%; }
    .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 2.5px; color: var(--ink-soft); margin-bottom: 12px; }
    h1 { font-family: Fraunces, serif; font-style: italic; font-weight: 300; font-size: clamp(26px, 4vw, 34px); line-height: 1.15; letter-spacing: -0.5px; margin-bottom: 24px; }
    .divider { border: none; border-top: 0.5px solid var(--line); margin: 28px 0; }
    .step { display: flex; gap: 16px; align-items: flex-start; margin-bottom: 24px; }
    .step:last-child { margin-bottom: 0; }
    .step-num { width: 28px; height: 28px; border-radius: 50%; background: var(--moss-light); color: var(--moss-deep); font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
    .step-body { flex: 1; }
    .step-label { font-size: 14px; font-weight: 500; margin-bottom: 6px; }
    .step-desc { font-size: 13px; color: var(--ink-soft); line-height: 1.55; }
    .btn { display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px; border-radius: 100px; font-size: 14px; font-weight: 500; cursor: pointer; text-decoration: none; border: none; transition: background 0.2s; }
    .btn-primary { background: var(--ink); color: var(--cream); }
    .btn-primary:hover { background: var(--moss-deep); }
    .btn-copy { background: var(--moss-light); color: var(--moss-deep); margin-top: 12px; font-size: 13px; padding: 10px 20px; }
    .btn-copy:hover { background: #c8d9c0; }
    .token-box { background: var(--cream); border-radius: 12px; border: 0.5px solid var(--line); padding: 14px 16px; font-family: monospace; font-size: 12px; word-break: break-all; color: var(--ink); letter-spacing: 0.5px; margin-top: 12px; user-select: all; }
    .qr-wrap { margin-top: 16px; display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
    .expiry { font-size: 12px; color: var(--ink-soft); margin-top: 20px; padding-top: 16px; border-top: 0.5px solid var(--line); }
    canvas { border-radius: 10px; }
  </style>
</head>
<body data-device-token="${eToken}">
  <div class="logo"><span class="logo-dot"></span> Sentra</div>

  <div class="card">
    <div class="eyebrow">Device Setup</div>
    <h1>Connect <em>${eChildName}</em>'s browser to Sentra</h1>

    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <div class="step-label">Install the Sentra extension</div>
        <div class="step-desc">Click below to add Sentra to Chrome on this device. It takes under a minute.</div>
        <div style="margin-top:14px">
          <a class="btn btn-primary" href="https://chrome.google.com/webstore/detail/sentra-child-safety-monitor" target="_blank" id="install-btn">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v6M5 8h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            Add to Chrome
          </a>
        </div>
      </div>
    </div>

    <hr class="divider">

    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <div class="step-label">Connect to ${eChildName}'s profile</div>
        <div class="step-desc">After installing, Sentra will automatically connect to ${eChildName}'s profile. No copying needed.</div>
        <div class="token-box" id="token-val">${eToken}</div>
        <div style="font-size:12px;color:#3C4A42;margin-top:8px">Already have Sentra installed? Copy this token and paste it in the extension settings.</div>
        <div class="qr-wrap">
          <img id="qr-img" style="border-radius:10px;width:100px;height:100px" alt="QR code">
          <button class="btn btn-copy" id="copy-btn">Copy token</button>
        </div>
      </div>
    </div>

    <div class="expiry">⏱ This link expires in 24 hours. Device: <strong>${eDeviceName}</strong></div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
  <script>
    QRCode.toDataURL('sentra-token:${device_token}', {
      width: 100, margin: 1,
      color: { dark: '#1A2A22', light: '#FBF7EB' }
    }, function(err, url) {
      if (!err) {
        document.getElementById('qr-img').src = url
      } else {
        // fallback: external QR API
        document.getElementById('qr-img').src =
          'https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=' +
          encodeURIComponent('sentra-token:${device_token}')
      }
    })

    document.getElementById('copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText('${device_token}').then(() => {
        const btn = document.getElementById('copy-btn')
        btn.textContent = 'Copied!'
        setTimeout(() => { btn.textContent = 'Copy token' }, 2500)
      })
    })
  </script>
</body>
</html>`)
})

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
