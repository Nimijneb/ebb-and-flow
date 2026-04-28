import bcrypt from "bcryptjs";
import type Database from "better-sqlite3";
import { newInviteCode } from "./invite.js";

function adminUsernameFromEnv(): string | undefined {
  const raw =
    process.env.ADMIN_USERNAME?.trim() ??
    process.env.ADMIN_EMAIL?.trim();
  return raw ? raw.toLowerCase() : undefined;
}

/**
 * If ADMIN_USERNAME (or legacy ADMIN_EMAIL) and ADMIN_PASSWORD are set:
 * - Creates the admin user + household when missing
 * - If that username already exists, sets is_admin = 1 (password unchanged)
 */
export function seedAdminFromEnv(db: Database.Database): void {
  const username = adminUsernameFromEnv();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    return;
  }
  if (password.length < 8) {
    console.warn(
      "ADMIN_PASSWORD must be at least 8 characters; skipping admin seed."
    );
    return;
  }

  const row = db
    .prepare("SELECT id, household_id FROM users WHERE username = ?")
    .get(username) as { id: number; household_id: number | null } | undefined;

  if (row) {
    db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(row.id);
    if (row.household_id == null) {
      const code = newInviteCode();
      const info = db
        .prepare("INSERT INTO households (name, invite_code) VALUES (?, ?)")
        .run("Home", code);
      const hid = Number(info.lastInsertRowid);
      db.prepare("UPDATE users SET household_id = ? WHERE id = ?").run(
        hid,
        row.id
      );
    }
    console.log(`Admin role ensured for existing user: ${username}`);
    return;
  }

  const code = newInviteCode();
  const hInfo = db
    .prepare("INSERT INTO households (name, invite_code) VALUES (?, ?)")
    .run("Home", code);
  const householdId = Number(hInfo.lastInsertRowid);
  const hash = bcrypt.hashSync(password, 12);
  db.prepare(
    `INSERT INTO users (username, password_hash, household_id, is_admin)
     VALUES (?, ?, ?, 1)`
  ).run(username, hash, householdId);
  console.log(`Seeded admin user: ${username}`);
}
