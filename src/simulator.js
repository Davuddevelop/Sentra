import db from './db/schema.js'
import crypto from 'crypto'
import bcrypt from 'bcrypt'

const DEMO_EMAIL    = 'demo@sentra.app'
const DEMO_PASSWORD = 'sentra-demo-2025'

const SCENARIOS = [
  { type: 'ai.emotional_dependency', payload: { app: 'Character.AI', session_minutes: 180, sessions_today: 6 }, title: 'Long Character.AI session detected', body: 'Emma has spent 3+ hours in a single Character.AI session today.' },
  { type: 'ai.jailbreak_attempt',    payload: { app: 'ChatGPT', prompt_pattern: 'ignore previous instructions', attempts: 3 }, title: 'Jailbreak attempt on ChatGPT', body: 'Liam tried to bypass ChatGPT safety filters 3 times in the last hour.' },
  { type: 'contact.unknown_dm',      payload: { platform: 'Discord', contact_type: 'outside_friend_graph', contact_age_unknown: true }, title: 'Unknown contact reached out on Discord', body: 'Emma received a direct message from someone outside her known contacts.' },
  { type: 'screen.late_night',       payload: { app: 'TikTok', start_time: '23:14', duration_minutes: 134 }, title: 'Late-night TikTok use', body: 'Emma was on TikTok for 2h 14m after bedtime on Tuesday.' },
  { type: 'ai.romantic_roleplay',    payload: { app: 'Character.AI', persona_type: 'romantic', session_frequency: 'daily' }, title: 'Romantic roleplay pattern on Character.AI', body: "Emma's Character.AI usage shows a daily romantic roleplay pattern." },
  { type: 'app.scan_clean',          payload: { apps_scanned: 47, threats_found: 0 }, title: 'Weekly device scan complete', body: '47 apps scanned — all clear.' },
  { type: 'privacy.data_shared',     payload: { platform: 'Instagram', data_type: 'location', app: 'Instagram Stories' }, title: 'Location shared publicly on Instagram', body: "Emma's Instagram Story included a precise location tag." },
  { type: 'contact.off_platform',    payload: { platform: 'Roblox', message: 'move to Discord', contact_age_unknown: true }, title: 'Off-platform move attempt on Roblox', body: 'An unknown user asked Liam to continue chatting on Discord.' },
  { type: 'screen.excessive',        payload: { total_hours: 9.5, day: 'Saturday' }, title: 'Excessive screen time on Saturday', body: "Liam's total screen time reached 9.5 hours yesterday." },
  { type: 'ai.harmful_advice',       payload: { app: 'ChatGPT', topic_category: 'diet_restriction', flagged: true }, title: 'Potentially harmful advice from ChatGPT', body: 'ChatGPT provided dietary restriction advice that may be harmful for a child.' },
]

const RISK_SCORE = {
  'ai.romantic_roleplay': 85, 'ai.jailbreak_attempt': 80, 'ai.harmful_advice': 90,
  'ai.emotional_dependency': 60, 'contact.unknown_dm': 70, 'contact.off_platform': 75,
  'screen.late_night': 40, 'screen.excessive': 35, 'privacy.data_shared': 65, 'app.scan_clean': 0,
}
const ALERT_LEVEL = s => s >= 80 ? 'critical' : s >= 60 ? 'warn' : s >= 20 ? 'info' : 'ok'

async function ensureDemoFamily() {
  let user = await db.prepare('SELECT * FROM users WHERE email = ?').get(DEMO_EMAIL)

  if (!user) {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)
    const { lastInsertRowid: userId } = await db
      .prepare('INSERT INTO users (name, email, password_hash, plan) VALUES (?, ?, ?, ?)')
      .run('Demo Parent', DEMO_EMAIL, passwordHash, 'family')

    const { lastInsertRowid: familyId } = await db
      .prepare('INSERT INTO families (owner_id, name) VALUES (?, ?)')
      .run(userId, 'Demo Family')

    const { lastInsertRowid: child1 } = await db
      .prepare('INSERT INTO children (family_id, name, age) VALUES (?, ?, ?)')
      .run(familyId, 'Emma', 14)

    const { lastInsertRowid: child2 } = await db
      .prepare('INSERT INTO children (family_id, name, age) VALUES (?, ?, ?)')
      .run(familyId, 'Liam', 11)

    const token1 = crypto.randomBytes(16).toString('hex')
    const token2 = crypto.randomBytes(16).toString('hex')

    await db.prepare('INSERT INTO devices (child_id, name, platform, device_token) VALUES (?, ?, ?, ?)').run(child1, "Emma's iPhone", 'ios', token1)
    await db.prepare('INSERT INTO devices (child_id, name, platform, device_token) VALUES (?, ?, ?, ?)').run(child2, "Liam's iPad",   'ios', token2)

    console.log('[simulator] Demo family created')
    user = await db.prepare('SELECT * FROM users WHERE email = ?').get(DEMO_EMAIL)
  }

  const family  = await db.prepare('SELECT * FROM families WHERE owner_id = ?').get(user.id)
  const devices = await db.prepare(`
    SELECT d.* FROM devices d
    JOIN children c ON c.id = d.child_id
    WHERE c.family_id = ?
  `).all(family.id)

  return { user, family, devices }
}

async function fireSignal(device, scenario, at = null) {
  const risk    = RISK_SCORE[scenario.type] ?? 20
  const level   = ALERT_LEVEL(risk)
  const payload = JSON.stringify(scenario.payload)
  const ts      = at || new Date().toISOString()

  const { lastInsertRowid: sigId } = await db
    .prepare('INSERT INTO signals (device_id, type, payload, risk_score, processed, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(device.id, scenario.type, payload, risk, ts)

  const child = await db.prepare('SELECT * FROM children WHERE id = ?').get(device.child_id)

  if (risk >= 20) {
    await db.prepare(`
      INSERT INTO alerts (family_id, child_id, signal_id, level, category, title, body, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      child.family_id, child.id, sigId, level,
      scenario.type.split('.')[0],
      scenario.title.replace('Emma', child.name).replace('Liam', child.name),
      scenario.body.replace('Emma', child.name).replace('Liam', child.name),
      ts,
    )
  }

  await db.prepare('UPDATE devices SET last_seen = CURRENT_TIMESTAMP WHERE id = ?').run(device.id)
}

const DAILY_COUNTS = [3, 5, 2, 6, 4, 7, 3]

async function seedHistoricalWeek(devices) {
  const row = await db.prepare(
    'SELECT COUNT(*) as c FROM signals WHERE device_id IN (' + devices.map(() => '?').join(',') + ')'
  ).get(...devices.map(d => d.id))
  if ((row?.c ?? 0) > 10) return

  let total = 0
  for (let daysAgo = 6; daysAgo >= 0; daysAgo--) {
    const count = DAILY_COUNTS[6 - daysAgo]
    for (let i = 0; i < count; i++) {
      const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)]
      const device   = devices[Math.floor(Math.random() * devices.length)]
      const hour     = 8 + Math.floor(Math.random() * 14)
      const minute   = Math.floor(Math.random() * 60)
      const d        = new Date()
      d.setDate(d.getDate() - daysAgo)
      d.setHours(hour, minute, 0, 0)
      await fireSignal(device, scenario, d.toISOString())
      total++
    }
  }
  console.log(`[simulator] Seeded ${total} historical signals across 7 days`)
}

export async function startSimulator() {
  if (process.env.NODE_ENV === 'production') return

  const { devices } = await ensureDemoFamily()
  if (!devices.length) return

  await seedHistoricalWeek(devices)

  setInterval(async () => {
    const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)]
    const device   = devices[Math.floor(Math.random() * devices.length)]
    await fireSignal(device, scenario)
    console.log(`[simulator] fired: ${scenario.type}`)
  }, 45_000)
}
