import nodemailer from 'nodemailer'

let transporter = null

function getTransporter() {
  if (transporter) return transporter

  if (process.env.SMTP_HOST && !process.env.SMTP_HOST.includes('ethereal')) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  } else {
    // Dev: log to console instead of sending
    transporter = { sendMail: async (opts) => { console.log('[EMAIL]', opts.subject, '→', opts.to); return {} } }
  }

  return transporter
}

const FROM = process.env.EMAIL_FROM || 'Sentra <alerts@sentra.app>'

function alertEmail({ parentName, parentEmail, childName, alert }) {
  const levelColor = { critical: '#C85A2E', warn: '#D97706', info: '#2C5A3F', ok: '#2C5A3F' }
  const color = levelColor[alert.level] || '#1A2A22'

  return {
    from: FROM,
    to: parentEmail,
    subject: `Sentra alert: ${alert.title}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3EDDD;font-family:Inter,-apple-system,sans-serif">
  <div style="max-width:520px;margin:40px auto;padding:0 20px">

    <!-- Logo -->
    <div style="margin-bottom:32px;font-family:Georgia,serif;font-size:22px;color:#1A2A22;font-weight:500">
      ◆ Sentra
    </div>

    <!-- Card -->
    <div style="background:#FBF7EB;border-radius:20px;padding:36px;border:0.5px solid rgba(26,42,34,0.14)">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:${color};font-weight:600;margin-bottom:12px">
        ${alert.level} alert
      </div>
      <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#1A2A22;margin:0 0 12px;letter-spacing:-0.5px;line-height:1.1">
        ${alert.title}
      </h1>
      <p style="font-size:15px;color:#3C4A42;line-height:1.6;margin:0 0 24px">
        ${alert.body}
      </p>

      <div style="background:#F3EDDD;border-radius:12px;padding:16px 20px;margin-bottom:28px">
        <div style="font-size:12px;color:#3C4A42;margin-bottom:4px">Child</div>
        <div style="font-size:15px;font-weight:500;color:#1A2A22">${childName}</div>
      </div>

      <a href="${process.env.APP_URL || 'http://localhost:5173'}/dashboard.html"
         style="display:inline-block;background:#1A2A22;color:#F8F4E8;padding:14px 28px;border-radius:100px;text-decoration:none;font-size:14px;font-weight:500">
        View in dashboard →
      </a>
    </div>

    <p style="font-size:12px;color:#3C4A42;margin-top:24px;text-align:center;line-height:1.6">
      Sentra monitors behavior patterns, never message content.<br>
      <a href="#" style="color:#2C5A3F">Manage alert settings</a> · <a href="#" style="color:#2C5A3F">Unsubscribe</a>
    </p>
  </div>
</body>
</html>`,
  }
}

function welcomeEmail({ name, email }) {
  return {
    from: FROM,
    to: email,
    subject: 'Welcome to Sentra — your family is protected',
    html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#F3EDDD;font-family:Inter,-apple-system,sans-serif">
  <div style="max-width:520px;margin:40px auto;padding:0 20px">
    <div style="margin-bottom:32px;font-family:Georgia,serif;font-size:22px;color:#1A2A22;font-weight:500">◆ Sentra</div>
    <div style="background:#FBF7EB;border-radius:20px;padding:36px;border:0.5px solid rgba(26,42,34,0.14)">
      <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:400;color:#1A2A22;margin:0 0 12px;letter-spacing:-0.5px">
        Welcome, ${name}.
      </h1>
      <p style="font-size:15px;color:#3C4A42;line-height:1.6;margin:0 0 24px">
        Your Sentra account is ready. Add your first child to start monitoring — setup takes under 3 minutes.
      </p>
      <a href="${process.env.APP_URL || 'http://localhost:5173'}/dashboard.html"
         style="display:inline-block;background:#2C5A3F;color:#F8F4E8;padding:14px 28px;border-radius:100px;text-decoration:none;font-size:14px;font-weight:500">
        Go to dashboard →
      </a>
    </div>
  </div>
</body>
</html>`,
  }
}

export async function sendAlertEmail({ parentName, parentEmail, childName, alert }) {
  try {
    await getTransporter().sendMail(alertEmail({ parentName, parentEmail, childName, alert }))
  } catch (err) {
    console.error('[email] alert send failed:', err.message)
  }
}

export async function sendConsentEmail({ name, email, consentToken }) {
  const appUrl  = process.env.APP_URL || 'http://localhost:3001'
  const verifyUrl = `${appUrl}/api/auth/verify-consent?token=${consentToken}`
  try {
    await getTransporter().sendMail({
      from: FROM, to: email,
      subject: 'Sentra — confirm your parental consent',
      html: `
<!DOCTYPE html><html>
<body style="margin:0;padding:0;background:#F3EDDD;font-family:Inter,-apple-system,sans-serif">
  <div style="max-width:520px;margin:40px auto;padding:0 20px">
    <div style="margin-bottom:32px;font-family:Georgia,serif;font-size:22px;color:#1A2A22;font-weight:500">◆ Sentra</div>
    <div style="background:#FBF7EB;border-radius:20px;padding:36px;border:0.5px solid rgba(26,42,34,0.14)">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#C85A2E;font-weight:600;margin-bottom:12px">Action required</div>
      <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#1A2A22;margin:0 0 12px;letter-spacing:-0.5px">
        Confirm your parental consent.
      </h1>
      <p style="font-size:15px;color:#3C4A42;line-height:1.6;margin:0 0 8px">
        Hi ${name}, you've created a Sentra account to monitor your child's AI chatbot activity.
      </p>
      <p style="font-size:15px;color:#3C4A42;line-height:1.6;margin:0 0 24px">
        To comply with COPPA and activate monitoring, please confirm you are the parent or legal guardian of the children you will monitor.
      </p>
      <a href="${verifyUrl}"
         style="display:inline-block;background:#2C5A3F;color:#F8F4E8;padding:16px 32px;border-radius:100px;text-decoration:none;font-size:15px;font-weight:600">
        Confirm parental consent →
      </a>
      <p style="font-size:12px;color:#3C4A42;margin-top:20px;line-height:1.6">
        This link expires in 48 hours. If you did not create this account, you can safely ignore this email.<br><br>
        Sentra monitors behavioral metadata only — we never read message content.<br>
        <a href="${appUrl}/privacy" style="color:#2C5A3F">Privacy policy</a>
      </p>
    </div>
  </div>
</body></html>`,
    })
  } catch (err) {
    console.error('[email] consent send failed:', err.message)
  }
}

export async function sendWelcomeEmail({ name, email }) {
  try {
    await getTransporter().sendMail(welcomeEmail({ name, email }))
  } catch (err) {
    console.error('[email] welcome send failed:', err.message)
  }
}

function weeklyDigestEmail({ parentName, parentEmail, children, weekStart, weekEnd }) {
  const totalSignals  = children.reduce((s, c) => s + c.signals, 0)
  const totalCritical = children.reduce((s, c) => s + c.critical, 0)
  const statusColor   = totalCritical > 0 ? '#C85A2E' : '#2C5A3F'
  const statusLabel   = totalCritical > 0 ? `${totalCritical} critical alerts need your attention` : 'All clear — no critical alerts this week'

  const childRows = children.map(c => `
    <tr>
      <td style="padding:14px 0;border-bottom:0.5px solid rgba(26,42,34,0.1);font-size:14px;font-weight:500;color:#1A2A22">${c.name}</td>
      <td style="padding:14px 0;border-bottom:0.5px solid rgba(26,42,34,0.1);font-size:14px;color:#3C4A42;text-align:center">${c.signals}</td>
      <td style="padding:14px 0;border-bottom:0.5px solid rgba(26,42,34,0.1);font-size:14px;color:${c.critical > 0 ? '#C85A2E' : '#3C4A42'};text-align:center;font-weight:${c.critical > 0 ? '600' : '400'}">${c.critical}</td>
      <td style="padding:14px 0;border-bottom:0.5px solid rgba(26,42,34,0.1);font-size:14px;color:${c.warn > 0 ? '#D97706' : '#3C4A42'};text-align:center">${c.warn}</td>
    </tr>
  `).join('')

  return {
    from: FROM,
    to: parentEmail,
    subject: `Sentra weekly report — ${weekStart} to ${weekEnd}`,
    html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#F3EDDD;font-family:Inter,-apple-system,sans-serif">
  <div style="max-width:560px;margin:40px auto;padding:0 20px">
    <div style="margin-bottom:32px;font-family:Georgia,serif;font-size:22px;color:#1A2A22;font-weight:500">◆ Sentra</div>

    <div style="background:#FBF7EB;border-radius:20px;padding:36px;border:0.5px solid rgba(26,42,34,0.14)">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#3C4A42;margin-bottom:12px">Weekly report</div>
      <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:400;color:#1A2A22;margin:0 0 8px;letter-spacing:-0.5px">
        ${weekStart} – ${weekEnd}
      </h1>
      <p style="font-size:15px;color:${statusColor};font-weight:500;margin:0 0 28px">${statusLabel}</p>

      <!-- Summary row -->
      <div style="display:flex;gap:16px;margin-bottom:28px">
        <div style="flex:1;background:#F3EDDD;border-radius:14px;padding:18px;text-align:center">
          <div style="font-size:32px;font-family:Georgia,serif;font-weight:400;color:#1A2A22;margin-bottom:4px">${totalSignals}</div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#3C4A42">Signals</div>
        </div>
        <div style="flex:1;background:#F3EDDD;border-radius:14px;padding:18px;text-align:center">
          <div style="font-size:32px;font-family:Georgia,serif;font-weight:400;color:${totalCritical > 0 ? '#C85A2E' : '#1A2A22'};margin-bottom:4px">${totalCritical}</div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#3C4A42">Critical</div>
        </div>
      </div>

      <!-- Per-child table -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:28px">
        <thead>
          <tr>
            <th style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#3C4A42;font-weight:500;padding-bottom:12px;text-align:left">Child</th>
            <th style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#3C4A42;font-weight:500;padding-bottom:12px;text-align:center">Signals</th>
            <th style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#3C4A42;font-weight:500;padding-bottom:12px;text-align:center">Critical</th>
            <th style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#3C4A42;font-weight:500;padding-bottom:12px;text-align:center">Warnings</th>
          </tr>
        </thead>
        <tbody>${childRows}</tbody>
      </table>

      <a href="${process.env.APP_URL || 'http://localhost:5173'}/dashboard.html"
         style="display:inline-block;background:#1A2A22;color:#F8F4E8;padding:14px 28px;border-radius:100px;text-decoration:none;font-size:14px;font-weight:500">
        View full report →
      </a>
    </div>

    <p style="font-size:12px;color:#3C4A42;margin-top:24px;text-align:center;line-height:1.6">
      Sentra monitors behavior patterns, never message content.<br>
      <a href="${process.env.APP_URL || 'http://localhost:5173'}/privacy" style="color:#2C5A3F">Privacy policy</a> · <a href="#" style="color:#2C5A3F">Unsubscribe</a>
    </p>
  </div>
</body>
</html>`,
  }
}

export async function sendWeeklyDigest({ parentName, parentEmail, children, weekStart, weekEnd }) {
  try {
    await getTransporter().sendMail(weeklyDigestEmail({ parentName, parentEmail, children, weekStart, weekEnd }))
  } catch (err) {
    console.error('[email] weekly digest failed:', err.message)
  }
}
