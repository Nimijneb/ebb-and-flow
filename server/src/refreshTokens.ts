import crypto from "node:crypto";
import type Database from "better-sqlite3";

const REFRESH_DAYS = 30;

export function hashRefreshToken(plain: string): string {
  return crypto.createHash("sha256").update(plain, "utf8").digest("hex");
}

function insertRefreshToken(db: Database.Database, userId: number): string {
  const plain = crypto.randomBytes(32).toString("hex");
  const h = hashRefreshToken(plain);
  const expires = new Date(
    Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  db.prepare(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?,?,?)`
  ).run(userId, h, expires);
  return plain;
}

/** Replace all refresh tokens for a user (e.g. new login). Returns the new opaque token. */
export function replaceUserRefreshTokens(
  db: Database.Database,
  userId: number
): string {
  db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(userId);
  return insertRefreshToken(db, userId);
}

/** Validate opaque refresh token, revoke old row, issue new token (rotation). */
export function rotateRefreshToken(
  db: Database.Database,
  plainRefreshToken: string
): { userId: number; newRefreshPlain: string } | null {
  const h = hashRefreshToken(plainRefreshToken);
  const row = db
    .prepare(
      `SELECT id, user_id FROM refresh_tokens
       WHERE token_hash = ? AND expires_at > datetime('now')`
    )
    .get(h) as { id: number; user_id: number } | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM refresh_tokens WHERE id = ?").run(row.id);
  const newPlain = insertRefreshToken(db, row.user_id);
  return { userId: row.user_id, newRefreshPlain: newPlain };
}

export function revokeRefreshToken(
  db: Database.Database,
  plainRefreshToken: string
): void {
  const h = hashRefreshToken(plainRefreshToken);
  db.prepare("DELETE FROM refresh_tokens WHERE token_hash = ?").run(h);
}
