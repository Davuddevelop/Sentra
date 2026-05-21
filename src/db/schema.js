import { createClient } from '@libsql/client'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const client = createClient({
  url:       process.env.TURSO_DATABASE_URL ?? `file:${process.env.DB_PATH ?? join(__dirname, '../../sentra.db')}`,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

try {
  await client.execute('PRAGMA journal_mode = WAL')
  await client.execute('PRAGMA foreign_keys = ON')
  await client.execute('PRAGMA cache_size = -20000')  // 20MB page cache
  await client.execute('PRAGMA synchronous = NORMAL')  // faster writes, safe with WAL
} catch (err) {
  console.warn('[db] PRAGMA setup warning:', err.message)
}

const TABLES = [
  `CREATE TABLE IF NOT EXISTS waitlist (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT UNIQUE NOT NULL,
    plan       TEXT NOT NULL DEFAULT 'family',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    email               TEXT UNIQUE NOT NULL,
    password_hash       TEXT NOT NULL,
    name                TEXT NOT NULL,
    plan                TEXT NOT NULL DEFAULT 'starter',
    plan_status         TEXT NOT NULL DEFAULT 'active',
    consent_verified    INTEGER NOT NULL DEFAULT 0,
    consent_token       TEXT,
    consent_sent_at     DATETIME,
    stripe_customer_id  TEXT,
    stripe_sub_id       TEXT,
    push_token          TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS families (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    co_owner_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS children (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id  INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    age        INTEGER,
    avatar     TEXT DEFAULT 'default',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS devices (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id     INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    platform     TEXT NOT NULL DEFAULT 'ios',
    device_token TEXT UNIQUE NOT NULL,
    last_seen    DATETIME,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS signals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    payload     TEXT NOT NULL DEFAULT '{}',
    risk_score  INTEGER NOT NULL DEFAULT 0,
    processed   INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS alerts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id  INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    child_id   INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    signal_id  INTEGER REFERENCES signals(id),
    level      TEXT NOT NULL DEFAULT 'info',
    category   TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    read       INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_family  ON alerts(family_id, read, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_child   ON alerts(child_id, level, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_signals_device ON signals(device_id, processed, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_signals_type   ON signals(type, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_devices_child  ON devices(child_id)`,
  `CREATE INDEX IF NOT EXISTS idx_devices_token  ON devices(device_token)`,
  `CREATE INDEX IF NOT EXISTS idx_children_family ON children(family_id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_consent  ON users(consent_token) WHERE consent_token IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_families_owner ON families(owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_read    ON alerts(family_id, read) WHERE read = 0`,
  `CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS install_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token      TEXT UNIQUE NOT NULL,
    device_id  INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_install_tokens ON install_tokens(token, expires_at)`,
  `CREATE TABLE IF NOT EXISTS consent_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event      TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_consent_log_user ON consent_log(user_id, created_at DESC)`,
]

for (const sql of TABLES) {
  await client.execute(sql)
}

// Column migrations — safe to run repeatedly
async function addColIfMissing(table, col, def) {
  const res = await client.execute(`PRAGMA table_info(${table})`)
  if (!res.rows.some(r => r.name === col)) {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
  }
}

await addColIfMissing('families', 'co_owner_id',      'INTEGER REFERENCES users(id)')
await addColIfMissing('users',    'plan_status',        "TEXT NOT NULL DEFAULT 'active'")
await addColIfMissing('users',    'consent_verified',   'INTEGER NOT NULL DEFAULT 0')
await addColIfMissing('users',    'consent_token',      'TEXT')
await addColIfMissing('users',    'consent_sent_at',    'DATETIME')
await addColIfMissing('users',    'stripe_customer_id', 'TEXT')
await addColIfMissing('users',    'stripe_sub_id',      'TEXT')
await addColIfMissing('users',    'push_token',         'TEXT')
await addColIfMissing('alerts',   'guidance',           'TEXT')

// Compatibility wrapper — mimics better-sqlite3's prepare().get/all/run() API as async
function prepare(sql) {
  return {
    async get(...args)  {
      const res = await client.execute({ sql, args })
      return res.rows[0] ?? null
    },
    async all(...args)  {
      const res = await client.execute({ sql, args })
      return Array.from(res.rows)
    },
    async run(...args)  {
      const res = await client.execute({ sql, args })
      return {
        lastInsertRowid: Number(res.lastInsertRowid ?? 0),
        changes:         res.rowsAffected ?? 0,
      }
    },
  }
}

const db = { prepare }
export default db
