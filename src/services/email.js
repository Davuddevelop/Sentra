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

      <a href="http://localhost:8000/dashboard.html"
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
      <a href="http://localhost:8000/dashboard.html"
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

export async function sendWelcomeEmail({ name, email }) {
  try {
    await getTransporter().sendMail(welcomeEmail({ name, email }))
  } catch (err) {
    console.error('[email] welcome send failed:', err.message)
  }
}
