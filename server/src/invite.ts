import crypto from "node:crypto";

/** 32 hex chars (128 bits) — share with family to join the same household. */
export function newInviteCode(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function normalizeInviteCode(raw: string): string {
  return raw.trim().toLowerCase();
}
