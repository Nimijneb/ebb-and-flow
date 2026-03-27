import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { newInviteCode } from "./invite.js";

const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "envelopes.db");

export function getDbPath(): string {
  return dbPath;
}

export function openDb(): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS households (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'Home',
      invite_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS envelopes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      opening_balance_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      envelope_id INTEGER NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_envelopes_user ON envelopes(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_envelope ON transactions(envelope_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
  `);

  migrateHouseholds(db);
  migrateEnvelopeShared(db);
  migrateScheduledTransactions(db);
  migrateRefreshTokens(db);
}

/** Shared = visible to whole household; private = only creator (same household). */
function migrateEnvelopeShared(db: Database.Database): void {
  const envCols = tableInfo(db, "envelopes");
  if (!envCols.some((c) => c.name === "is_shared")) {
    db.exec(
      "ALTER TABLE envelopes ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 1"
    );
  }
}

/** Monthly Ebb/Flow automation; transactions are created as the owning user. */
function migrateScheduledTransactions(db: Database.Database): void {
  const t = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_transactions'"
    )
    .get() as { name: string } | undefined;
  if (!t) {
    db.exec(`
      CREATE TABLE scheduled_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        envelope_id INTEGER NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
        day_of_month INTEGER NOT NULL CHECK(day_of_month >= 1 AND day_of_month <= 31),
        type TEXT NOT NULL CHECK(type IN ('ebb','flow')),
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
        note TEXT NOT NULL DEFAULT 'Scheduled',
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
        last_run_month TEXT
      );
      CREATE INDEX idx_sched_user ON scheduled_transactions(user_id);
      CREATE INDEX idx_sched_envelope ON scheduled_transactions(envelope_id);
    `);
  }
}

function migrateRefreshTokens(db: Database.Database): void {
  const t = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='refresh_tokens'"
    )
    .get() as { name: string } | undefined;
  if (!t) {
    db.exec(`
      CREATE TABLE refresh_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);
    `);
  }
}

const TABLE_INFO_ALLOWLIST = new Set([
  "users",
  "households",
  "envelopes",
  "transactions",
  "scheduled_transactions",
]);

function tableInfo(db: Database.Database, name: string): { name: string }[] {
  if (!TABLE_INFO_ALLOWLIST.has(name)) {
    throw new Error(`tableInfo: disallowed table name "${name}"`);
  }
  return db.pragma(`table_info(${name})`) as { name: string }[];
}

function migrateHouseholds(db: Database.Database): void {
  const userCols = tableInfo(db, "users");
  if (!userCols.some((c) => c.name === "household_id")) {
    db.exec(
      "ALTER TABLE users ADD COLUMN household_id INTEGER REFERENCES households(id)"
    );
  }

  const orphans = db
    .prepare("SELECT id FROM users WHERE household_id IS NULL")
    .all() as { id: number }[];
  for (const { id } of orphans) {
    const code = newInviteCode();
    const info = db
      .prepare("INSERT INTO households (name, invite_code) VALUES (?, ?)")
      .run("Home", code);
    const hid = Number(info.lastInsertRowid);
    db.prepare("UPDATE users SET household_id = ? WHERE id = ?").run(hid, id);
  }

  const envCols = tableInfo(db, "envelopes");
  if (!envCols.some((c) => c.name === "household_id")) {
    db.exec(
      "ALTER TABLE envelopes ADD COLUMN household_id INTEGER REFERENCES households(id)"
    );
  }

  db.prepare(
    `UPDATE envelopes SET household_id = (
      SELECT u.household_id FROM users u WHERE u.id = envelopes.user_id
    )
    WHERE household_id IS NULL`
  ).run();

  const stillNull = db
    .prepare("SELECT id FROM envelopes WHERE household_id IS NULL")
    .all() as { id: number }[];
  for (const { id } of stillNull) {
    const row = db
      .prepare("SELECT id FROM households ORDER BY id LIMIT 1")
      .get() as { id: number } | undefined;
    if (row) {
      db.prepare("UPDATE envelopes SET household_id = ? WHERE id = ?").run(
        row.id,
        id
      );
    }
  }

  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_envelopes_household ON envelopes(household_id)"
  );

  const userCols2 = tableInfo(db, "users");
  if (!userCols2.some((c) => c.name === "is_admin")) {
    db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
  }

  migrateEmailToUsername(db);
}

/** Legacy DBs used `email`; rename once to `username`. */
function migrateEmailToUsername(db: Database.Database): void {
  const cols = tableInfo(db, "users");
  const hasEmail = cols.some((c) => c.name === "email");
  const hasUsername = cols.some((c) => c.name === "username");
  if (hasEmail && !hasUsername) {
    db.exec("ALTER TABLE users RENAME COLUMN email TO username");
  }
}
