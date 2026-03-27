import type { Request, Response, NextFunction } from "express";
import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import type Database from "better-sqlite3";
import {
  verifyToken,
  signToken,
  attachUserFromToken,
  type AuthedRequest,
} from "./auth.js";
import { newInviteCode, normalizeInviteCode } from "./invite.js";

/** 1–64 chars, no spaces (stored lowercase). Printable characters allowed. */
const usernameSchema = z
  .string()
  .min(1)
  .max(64)
  .transform((s) => s.trim())
  .refine((s) => s.length > 0, "Required")
  .refine((s) => !/[\s\n\r]/.test(s), "No spaces in username");

const registerSchema = z.object({
  username: usernameSchema,
  password: z.string().min(8).max(128),
  invite_code: z.string().optional(),
});

const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(8).max(128),
});

const envelopeCreateSchema = z.object({
  name: z.string().min(1).max(120),
  opening_balance_cents: z.number().int().min(0).max(999_999_999_99),
  /** Omit or true = everyone in the household sees it; false = only you. */
  shared_with_household: z.boolean().optional(),
});

const transactionSchema = z.object({
  amount_cents: z.number().int().positive().max(999_999_999_99),
  type: z.enum(["ebb", "flow"]),
  note: z
    .string()
    .trim()
    .min(1, "Merchant or description is required")
    .max(500),
});

const householdPatchSchema = z.object({
  name: z.string().min(1).max(80),
});

const createMemberSchema = z.object({
  username: usernameSchema,
  password: z.string().min(8).max(128),
});

const scheduleCreateSchema = z.object({
  envelope_id: z.number().int().positive(),
  day_of_month: z.number().int().min(1).max(31),
  type: z.enum(["ebb", "flow"]),
  amount_cents: z.number().int().positive().max(999_999_999_99),
  note: z.string().trim().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
});

const schedulePatchSchema = z.object({
  envelope_id: z.number().int().positive().optional(),
  day_of_month: z.number().int().min(1).max(31).optional(),
  type: z.enum(["ebb", "flow"]).optional(),
  amount_cents: z.number().int().positive().max(999_999_999_99).optional(),
  note: z.string().trim().min(1).max(500).optional(),
  enabled: z.boolean().optional(),
});

function createAuthMiddleware(db: Database.Database) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const payload = verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    const urow = db
      .prepare("SELECT household_id, is_admin, username FROM users WHERE id = ?")
      .get(payload.sub) as
      | { household_id: number | null; is_admin: number; username: string }
      | undefined;
    if (!urow) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    let householdId = payload.householdId;
    if (typeof householdId !== "number" || !Number.isFinite(householdId)) {
      householdId = urow.household_id ?? undefined;
    }
    if (typeof householdId !== "number" || !Number.isFinite(householdId)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (urow.household_id != null && urow.household_id !== householdId) {
      householdId = urow.household_id;
    }
    const isAdmin = urow.is_admin === 1;
    (req as AuthedRequest).user = attachUserFromToken(
      { ...payload, username: urow.username },
      householdId,
      isAdmin
    );
    next();
  };
}

function householdPayload(
  db: Database.Database,
  householdId: number
): {
  id: number;
  name: string;
  invite_code: string;
  members: { id: number; username: string; is_admin: boolean }[];
} {
  const h = db
    .prepare("SELECT id, name, invite_code FROM households WHERE id = ?")
    .get(householdId) as
    | { id: number; name: string; invite_code: string }
    | undefined;
  if (!h) {
    throw new Error("Household missing");
  }
  const members = db
    .prepare(
      `SELECT id, username, is_admin FROM users WHERE household_id = ?
       ORDER BY username COLLATE NOCASE`
    )
    .all(householdId) as { id: number; username: string; is_admin: number }[];
  return {
    id: h.id,
    name: h.name,
    invite_code: h.invite_code,
    members: members.map((m) => ({
      id: m.id,
      username: m.username,
      is_admin: m.is_admin === 1,
    })),
  };
}

function userMePayload(
  db: Database.Database,
  userId: number,
  username: string,
  householdId: number
): {
  id: number;
  username: string;
  is_admin: boolean;
  household: ReturnType<typeof householdPayload>;
} {
  const row = db
    .prepare("SELECT is_admin FROM users WHERE id = ?")
    .get(userId) as { is_admin: number } | undefined;
  const is_admin = row?.is_admin === 1;
  return {
    id: userId,
    username,
    is_admin,
    household: householdPayload(db, householdId),
  };
}

export function createRouter(db: Database.Database): Router {
  const r = Router();
  const authMiddleware = createAuthMiddleware(db);
  const allowOpenRegistration = process.env.ALLOW_OPEN_REGISTRATION === "true";

  r.post("/api/auth/register", (req, res) => {
    if (!allowOpenRegistration) {
      res.status(403).json({
        error: "Registration is disabled. Ask your administrator for an account.",
      });
      return;
    }
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { username, password } = parsed.data;
    const userNorm = username.trim().toLowerCase();
    const rawInvite = parsed.data.invite_code;
    const inviteNorm =
      rawInvite && rawInvite.trim().length > 0
        ? normalizeInviteCode(rawInvite)
        : undefined;

    if (inviteNorm !== undefined && !/^[a-f0-9]{12}$/.test(inviteNorm)) {
      res.status(400).json({ error: "Invite code must be 12 hex characters" });
      return;
    }

    let householdId: number;
    if (inviteNorm) {
      const h = db
        .prepare("SELECT id FROM households WHERE invite_code = ?")
        .get(inviteNorm) as { id: number } | undefined;
      if (!h) {
        res.status(400).json({ error: "Invalid invite code" });
        return;
      }
      householdId = h.id;
    } else {
      const code = newInviteCode();
      const info = db
        .prepare("INSERT INTO households (name, invite_code) VALUES (?, ?)")
        .run("Home", code);
      householdId = Number(info.lastInsertRowid);
    }

    const hash = bcrypt.hashSync(password, 12);
    try {
      const stmt = db.prepare(
        "INSERT INTO users (username, password_hash, household_id) VALUES (?, ?, ?)"
      );
      const info = stmt.run(userNorm, hash, householdId);
      const id = Number(info.lastInsertRowid);
      const token = signToken(id, userNorm, householdId);
      res.status(201).json({
        token,
        user: userMePayload(db, id, userNorm, householdId),
      });
    } catch (e: unknown) {
      if (
        e &&
        typeof e === "object" &&
        "code" in e &&
        e.code === "SQLITE_CONSTRAINT_UNIQUE"
      ) {
        res.status(409).json({ error: "That username is already taken." });
        return;
      }
      throw e;
    }
  });

  r.post("/api/auth/login", (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { username, password } = parsed.data;
    const userNorm = username.trim().toLowerCase();
    const row = db
      .prepare(
        "SELECT id, username, password_hash, household_id FROM users WHERE username = ?"
      )
      .get(userNorm) as
      | {
          id: number;
          username: string;
          password_hash: string;
          household_id: number | null;
        }
      | undefined;
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }
    if (row.household_id == null) {
      res.status(500).json({ error: "Account data incomplete" });
      return;
    }
    const token = signToken(row.id, row.username, row.household_id);
    res.json({
      token,
      user: userMePayload(db, row.id, row.username, row.household_id),
    });
  });

  r.post("/api/admin/users", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    if (!user.isAdmin) {
      res.status(403).json({ error: "Only an administrator can create accounts." });
      return;
    }
    const parsed = createMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { username, password } = parsed.data;
    const userNorm = username.trim().toLowerCase();
    const hash = bcrypt.hashSync(password, 12);
    try {
      const info = db
        .prepare(
          `INSERT INTO users (username, password_hash, household_id, is_admin)
          VALUES (?, ?, ?, 0)`
        )
        .run(userNorm, hash, user.householdId);
      const id = Number(info.lastInsertRowid);
      res.status(201).json({
        user: { id, username: userNorm, is_admin: false },
      });
    } catch (e: unknown) {
      if (
        e &&
        typeof e === "object" &&
        "code" in e &&
        e.code === "SQLITE_CONSTRAINT_UNIQUE"
      ) {
        res.status(409).json({ error: "That username is already taken." });
        return;
      }
      throw e;
    }
  });

  r.get("/api/me", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    res.json({
      user: userMePayload(db, user.id, user.username, user.householdId),
    });
  });

  r.patch("/api/household", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const parsed = householdPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    db.prepare("UPDATE households SET name = ? WHERE id = ?").run(
      parsed.data.name,
      user.householdId
    );
    const household = householdPayload(db, user.householdId);
    res.json({ household });
  });

  r.get("/api/envelopes", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const envelopes = db
      .prepare(
        `SELECT e.id, e.name, e.opening_balance_cents, e.created_at, e.is_shared,
          COALESCE(SUM(t.amount_cents), 0) AS tx_sum
        FROM envelopes e
        LEFT JOIN transactions t ON t.envelope_id = e.id
        WHERE e.household_id = ? AND (e.is_shared = 1 OR e.user_id = ?)
        GROUP BY e.id
        ORDER BY e.created_at DESC`
      )
      .all(user.householdId, user.id) as Array<{
        id: number;
        name: string;
        opening_balance_cents: number;
        created_at: string;
        is_shared: number;
        tx_sum: number;
      }>;

    const out = envelopes.map((e) => ({
      id: e.id,
      name: e.name,
      opening_balance_cents: e.opening_balance_cents,
      balance_cents: e.opening_balance_cents + e.tx_sum,
      created_at: e.created_at,
      shared_with_household: e.is_shared === 1,
    }));
    res.json({ envelopes: out });
  });

  r.post("/api/envelopes", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const parsed = envelopeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { name, opening_balance_cents, shared_with_household } = parsed.data;
    const shared =
      shared_with_household === undefined ? true : shared_with_household;
    const isShared = shared ? 1 : 0;
    const info = db
      .prepare(
        `INSERT INTO envelopes (user_id, household_id, name, opening_balance_cents, is_shared)
        VALUES (?, ?, ?, ?, ?)`
      )
      .run(user.id, user.householdId, name, opening_balance_cents, isShared);
    const id = Number(info.lastInsertRowid);
    res.status(201).json({
      envelope: {
        id,
        name,
        opening_balance_cents,
        balance_cents: opening_balance_cents,
        created_at: new Date().toISOString(),
        shared_with_household: shared,
      },
    });
  });

  r.get("/api/envelopes/:id", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const row = db
      .prepare(
        `SELECT e.id, e.name, e.opening_balance_cents, e.created_at, e.is_shared,
          COALESCE(SUM(t.amount_cents), 0) AS tx_sum
        FROM envelopes e
        LEFT JOIN transactions t ON t.envelope_id = e.id
        WHERE e.id = ? AND e.household_id = ? AND (e.is_shared = 1 OR e.user_id = ?)
        GROUP BY e.id`
      )
      .get(id, user.householdId, user.id) as
      | {
          id: number;
          name: string;
          opening_balance_cents: number;
          created_at: string;
          is_shared: number;
          tx_sum: number;
        }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "Envelope not found" });
      return;
    }
    const transactions = db
      .prepare(
        `SELECT t.id, t.amount_cents, t.note, t.created_at, u.username AS recorded_by_username
        FROM transactions t
        JOIN users u ON u.id = t.user_id
        WHERE t.envelope_id = ?
        ORDER BY t.created_at DESC, t.id DESC`
      )
      .all(id) as Array<{
        id: number;
        amount_cents: number;
        note: string | null;
        created_at: string;
        recorded_by_username: string;
      }>;
    res.json({
      envelope: {
        id: row.id,
        name: row.name,
        opening_balance_cents: row.opening_balance_cents,
        balance_cents: row.opening_balance_cents + row.tx_sum,
        created_at: row.created_at,
        shared_with_household: row.is_shared === 1,
      },
      transactions,
    });
  });

  r.delete("/api/envelopes/:id", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const info = db
      .prepare(
        `DELETE FROM envelopes WHERE id = ? AND household_id = ?
         AND (is_shared = 1 OR user_id = ?)`
      )
      .run(id, user.householdId, user.id);
    if (info.changes === 0) {
      res.status(404).json({ error: "Envelope not found" });
      return;
    }
    res.status(204).send();
  });

  r.post("/api/envelopes/:id/transactions", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const env = db
      .prepare(
        `SELECT id FROM envelopes WHERE id = ? AND household_id = ?
         AND (is_shared = 1 OR user_id = ?)`
      )
      .get(id, user.householdId, user.id) as { id: number } | undefined;
    if (!env) {
      res.status(404).json({ error: "Envelope not found" });
      return;
    }
    const parsed = transactionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { amount_cents, type, note } = parsed.data;
    const signed = type === "flow" ? amount_cents : -amount_cents;
    const info = db
      .prepare(
        `INSERT INTO transactions (user_id, envelope_id, amount_cents, note)
        VALUES (?, ?, ?, ?)`
      )
      .run(user.id, id, signed, note);
    const txId = Number(info.lastInsertRowid);
    const sumRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS s FROM transactions WHERE envelope_id = ?`
      )
      .get(id) as { s: number };
    const envRow = db
      .prepare("SELECT opening_balance_cents FROM envelopes WHERE id = ?")
      .get(id) as { opening_balance_cents: number };
    res.status(201).json({
      transaction: {
        id: txId,
        amount_cents: signed,
        note,
        created_at: new Date().toISOString(),
      },
      balance_cents: envRow.opening_balance_cents + sumRow.s,
    });
  });

  function transactionBelongsToAccessibleEnvelope(
    txId: number,
    envelopeId: number,
    user: { householdId: number; id: number }
  ): boolean {
    const row = db
      .prepare(
        `SELECT t.id FROM transactions t
         JOIN envelopes e ON e.id = t.envelope_id
         WHERE t.id = ? AND t.envelope_id = ? AND e.household_id = ?
         AND (e.is_shared = 1 OR e.user_id = ?)`
      )
      .get(txId, envelopeId, user.householdId, user.id) as
      | { id: number }
      | undefined;
    return row != null;
  }

  r.patch(
    "/api/envelopes/:eid/transactions/:tid",
    authMiddleware,
    (req, res) => {
      const { user } = req as AuthedRequest;
      const envelopeId = Number(req.params.eid);
      const txId = Number(req.params.tid);
      if (!Number.isFinite(envelopeId) || !Number.isFinite(txId)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      if (!transactionBelongsToAccessibleEnvelope(txId, envelopeId, user)) {
        res.status(404).json({ error: "Transaction not found" });
        return;
      }
      const parsed = transactionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const { amount_cents, type, note } = parsed.data;
      const signed = type === "flow" ? amount_cents : -amount_cents;
      db.prepare(
        `UPDATE transactions SET amount_cents = ?, note = ? WHERE id = ? AND envelope_id = ?`
      ).run(signed, note, txId, envelopeId);
      const sumRow = db
        .prepare(
          `SELECT COALESCE(SUM(amount_cents), 0) AS s FROM transactions WHERE envelope_id = ?`
        )
        .get(envelopeId) as { s: number };
      const envRow = db
        .prepare("SELECT opening_balance_cents FROM envelopes WHERE id = ?")
        .get(envelopeId) as { opening_balance_cents: number };
      const trow = db
        .prepare(
          "SELECT id, amount_cents, note, created_at FROM transactions WHERE id = ?"
        )
        .get(txId) as {
        id: number;
        amount_cents: number;
        note: string | null;
        created_at: string;
      };
      res.json({
        transaction: {
          id: trow.id,
          amount_cents: trow.amount_cents,
          note: trow.note,
          created_at: trow.created_at,
        },
        balance_cents: envRow.opening_balance_cents + sumRow.s,
      });
    }
  );

  r.delete(
    "/api/envelopes/:eid/transactions/:tid",
    authMiddleware,
    (req, res) => {
      const { user } = req as AuthedRequest;
      const envelopeId = Number(req.params.eid);
      const txId = Number(req.params.tid);
      if (!Number.isFinite(envelopeId) || !Number.isFinite(txId)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      if (!transactionBelongsToAccessibleEnvelope(txId, envelopeId, user)) {
        res.status(404).json({ error: "Transaction not found" });
        return;
      }
      const info = db
        .prepare(
          "DELETE FROM transactions WHERE id = ? AND envelope_id = ?"
        )
        .run(txId, envelopeId);
      if (info.changes === 0) {
        res.status(404).json({ error: "Transaction not found" });
        return;
      }
      res.status(204).send();
    }
  );

  function getAccessibleEnvelopeId(
    user: { id: number; householdId: number },
    envelopeId: number
  ): { id: number } | undefined {
    return db
      .prepare(
        `SELECT e.id FROM envelopes e
         WHERE e.id = ? AND e.household_id = ?
         AND (e.is_shared = 1 OR e.user_id = ?)`
      )
      .get(envelopeId, user.householdId, user.id) as { id: number } | undefined;
  }

  r.get("/api/schedules", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const rows = db
      .prepare(
        `SELECT s.id, s.envelope_id, e.name AS envelope_name, s.day_of_month, s.type,
          s.amount_cents, s.note, s.enabled, s.last_run_month
         FROM scheduled_transactions s
         JOIN envelopes e ON e.id = s.envelope_id
         WHERE s.user_id = ?
         ORDER BY s.day_of_month ASC, s.id ASC`
      )
      .all(user.id) as Array<{
        id: number;
        envelope_id: number;
        envelope_name: string;
        day_of_month: number;
        type: "ebb" | "flow";
        amount_cents: number;
        note: string;
        enabled: number;
        last_run_month: string | null;
      }>;
    res.json({
      schedules: rows.map((r) => ({
        id: r.id,
        envelope_id: r.envelope_id,
        envelope_name: r.envelope_name,
        day_of_month: r.day_of_month,
        type: r.type,
        amount_cents: r.amount_cents,
        note: r.note,
        enabled: r.enabled === 1,
        last_run_month: r.last_run_month,
      })),
    });
  });

  r.post("/api/schedules", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const parsed = scheduleCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { envelope_id, day_of_month, type, amount_cents, enabled } =
      parsed.data;
    const note = parsed.data.note?.trim() || "Scheduled";
    if (!getAccessibleEnvelopeId(user, envelope_id)) {
      res.status(404).json({ error: "Envelope not found" });
      return;
    }
    const enabledFlag = enabled === false ? 0 : 1;
    const info = db
      .prepare(
        `INSERT INTO scheduled_transactions
        (user_id, envelope_id, day_of_month, type, amount_cents, note, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        user.id,
        envelope_id,
        day_of_month,
        type,
        amount_cents,
        note,
        enabledFlag
      );
    const id = Number(info.lastInsertRowid);
    const row = db
      .prepare(
        `SELECT s.id, s.envelope_id, e.name AS envelope_name, s.day_of_month, s.type,
          s.amount_cents, s.note, s.enabled, s.last_run_month
         FROM scheduled_transactions s
         JOIN envelopes e ON e.id = s.envelope_id
         WHERE s.id = ? AND s.user_id = ?`
      )
      .get(id, user.id) as
      | {
          id: number;
          envelope_id: number;
          envelope_name: string;
          day_of_month: number;
          type: "ebb" | "flow";
          amount_cents: number;
          note: string;
          enabled: number;
          last_run_month: string | null;
        }
      | undefined;
    if (!row) {
      res.status(500).json({ error: "Could not load schedule" });
      return;
    }
    res.status(201).json({
      schedule: {
        id: row.id,
        envelope_id: row.envelope_id,
        envelope_name: row.envelope_name,
        day_of_month: row.day_of_month,
        type: row.type,
        amount_cents: row.amount_cents,
        note: row.note,
        enabled: row.enabled === 1,
        last_run_month: row.last_run_month,
      },
    });
  });

  r.patch("/api/schedules/:id", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const existing = db
      .prepare(
        "SELECT id, envelope_id FROM scheduled_transactions WHERE id = ? AND user_id = ?"
      )
      .get(id, user.id) as { id: number; envelope_id: number } | undefined;
    if (!existing) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }
    const parsed = schedulePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const p = parsed.data;
    if (Object.keys(p).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const nextEnvelopeId = p.envelope_id ?? existing.envelope_id;
    if (!getAccessibleEnvelopeId(user, nextEnvelopeId)) {
      res.status(404).json({ error: "Envelope not found" });
      return;
    }

    const row = db
      .prepare(
        `SELECT envelope_id, day_of_month, type, amount_cents, note, enabled
         FROM scheduled_transactions WHERE id = ? AND user_id = ?`
      )
      .get(id, user.id) as
      | {
          envelope_id: number;
          day_of_month: number;
          type: "ebb" | "flow";
          amount_cents: number;
          note: string;
          enabled: number;
        }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    const envelope_id = p.envelope_id ?? row.envelope_id;
    const day_of_month = p.day_of_month ?? row.day_of_month;
    const type = p.type ?? row.type;
    const amount_cents = p.amount_cents ?? row.amount_cents;
    const note = p.note !== undefined ? p.note.trim() : row.note;
    const enabled =
      p.enabled !== undefined ? (p.enabled ? 1 : 0) : row.enabled;

    db.prepare(
      `UPDATE scheduled_transactions SET
        envelope_id = ?, day_of_month = ?, type = ?, amount_cents = ?, note = ?, enabled = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      envelope_id,
      day_of_month,
      type,
      amount_cents,
      note,
      enabled,
      id,
      user.id
    );

    const out = db
      .prepare(
        `SELECT s.id, s.envelope_id, e.name AS envelope_name, s.day_of_month, s.type,
          s.amount_cents, s.note, s.enabled, s.last_run_month
         FROM scheduled_transactions s
         JOIN envelopes e ON e.id = s.envelope_id
         WHERE s.id = ? AND s.user_id = ?`
      )
      .get(id, user.id) as
      | {
          id: number;
          envelope_id: number;
          envelope_name: string;
          day_of_month: number;
          type: "ebb" | "flow";
          amount_cents: number;
          note: string;
          enabled: number;
          last_run_month: string | null;
        }
      | undefined;
    if (!out) {
      res.status(500).json({ error: "Could not load schedule" });
      return;
    }
    res.json({
      schedule: {
        id: out.id,
        envelope_id: out.envelope_id,
        envelope_name: out.envelope_name,
        day_of_month: out.day_of_month,
        type: out.type,
        amount_cents: out.amount_cents,
        note: out.note,
        enabled: out.enabled === 1,
        last_run_month: out.last_run_month,
      },
    });
  });

  r.delete("/api/schedules/:id", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const info = db
      .prepare(
        "DELETE FROM scheduled_transactions WHERE id = ? AND user_id = ?"
      )
      .run(id, user.id);
    if (info.changes === 0) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }
    res.status(204).send();
  });

  r.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    next();
  });

  return r;
}
