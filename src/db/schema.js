import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH   = process.env.DB_PATH || join(__dirname, '../../sentra.db')
const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  /* ── Waitlist ─────────────────────────────────────────── */
  CREATE TABLE IF NOT EXISTS waitlist (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT UNIQUE NOT NULL,
    plan       TEXT NOT NULL DEFAULT 'family',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  /* ── Users (parents) ──────────────────────────────────── */
  CREATE TABLE IF NOT EXISTS users (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    email               TEXT UNIQUE NOT NULL,
    password_hash       TEXT NOT NULL,
    name                TEXT NOT NULL,
    plan                TEXT NOT NULL DEFAULT 'starter',
    plan_status         TEXT NOT NULL DEFAULT 'active',
    -- Verifiable COPPA consent
    consent_verified    INTEGER NOT NULL DEFAULT 0,
    consent_token       TEXT,
    consent_sent_at     DATETIME,
    -- Stripe
    stripe_customer_id  TEXT,
    stripe_sub_id       TEXT,
    -- Push notifications (parent's device)
    push_token          TEXT,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  /* ── Families ─────────────────────────────────────────── */
  CREATE TABLE IF NOT EXISTS families (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    co_owner_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  /* ── Children ─────────────────────────────────────────── */
  CREATE TABLE IF NOT EXISTS children (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id  INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    age        INTEGER,
    avatar     TEXT DEFAULT 'default',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  /* ── Devices ──────────────────────────────────────────── */
  CREATE TABLE IF NOT EXISTS devices (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id     INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    platform     TEXT NOT NULL DEFAULT 'ios',
    device_token TEXT UNIQUE NOT NULL,
    last_seen    DATETIME,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  /* ── Signals (raw events from child devices) ──────────── */
  CREATE TABLE IF NOT EXISTS signals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    payload     TEXT NOT NULL DEFAULT '{}',
    risk_score  INTEGER NOT NULL DEFAULT 0,
    processed   INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  /* ── Alerts (processed, shown to parent) ─────────────── */
  CREATE TABLE IF NOT EXISTS alerts (
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
  );

  /* ── Indexes ──────────────────────────────────────────── */
  CREATE INDEX IF NOT EXISTS idx_alerts_family    ON alerts(family_id, read, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_alerts_child     ON alerts(child_id, level, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_signals_device   ON signals(device_id, processed, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_signals_type     ON signals(type, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_devices_child    ON devices(child_id);
  CREATE INDEX IF NOT EXISTS idx_devices_token    ON devices(device_token);
  CREATE INDEX IF NOT EXISTS idx_children_family  ON children(family_id);
`)

// ── Column migrations (safe: skipped if column already exists) ──
const famCols = db.pragma('table_info(families)').map(r => r.name)
if (!famCols.includes('co_owner_id')) {
  db.exec('ALTER TABLE families ADD COLUMN co_owner_id INTEGER REFERENCES users(id)')
}

const userCols = db.pragma('table_info(users)').map(r => r.name)
const addIfMissing = (col, def) => {
  if (!userCols.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`)
}
addIfMissing('plan_status',        "TEXT NOT NULL DEFAULT 'active'")
addIfMissing('consent_verified',   'INTEGER NOT NULL DEFAULT 0')
addIfMissing('consent_token',      'TEXT')
addIfMissing('consent_sent_at',    'DATETIME')
addIfMissing('stripe_customer_id', 'TEXT')
addIfMissing('stripe_sub_id',      'TEXT')
addIfMissing('push_token',         'TEXT')

// This partial index needs consent_token to exist first
db.exec(`CREATE INDEX IF NOT EXISTS idx_users_consent ON users(consent_token) WHERE consent_token IS NOT NULL`)

export default db
