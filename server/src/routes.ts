import type { Request, Response, NextFunction } from "express";
import { Router } from "express";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type Database from "better-sqlite3";
import {
  verifyToken,
  signToken,
  attachUserFromToken,
  type AuthedRequest,
} from "./auth.js";
import { newInviteCode, normalizeInviteCode } from "./invite.js";
import {
  replaceUserRefreshTokens,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokensForUser,
} from "./refreshTokens.js";

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
  /**
   * Shared envelopes only: who may edit (non-admins). Admins may set any household member;
   * standard users must omit or set to themselves.
   */
  assigned_user_id: z.number().int().positive().optional(),
});

const envelopePatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    /** Set envelope total to this amount (opening balance is adjusted; transactions unchanged). */
    current_balance_cents: z.number().int().min(-999_999_999_99).max(999_999_999_99).optional(),
    /** Shared envelopes only: household admin sets who may edit (non-admins). */
    assigned_user_id: z.number().int().positive().optional(),
    shared_with_household: z.boolean().optional(),
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.current_balance_cents !== undefined ||
      d.assigned_user_id !== undefined ||
      d.shared_with_household !== undefined,
    { message: "Provide at least one field to update" }
  );

const transactionSchema = z.object({
  amount_cents: z.number().int().positive().max(999_999_999_99),
  type: z.enum(["ebb", "flow"]),
  note: z
    .string()
    .trim()
    .min(1, "Merchant or description is required")
    .max(500),
  /** ISO 8601 or parseable date string; omit for “now” on create, omit on patch to leave unchanged */
  created_at: z.string().optional(),
});

function normalizeOptionalCreatedAt(
  raw: string | undefined
): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return undefined;
  return new Date(t).toISOString();
}

const householdPatchSchema = z.object({
  name: z.string().min(1).max(80),
});

const createMemberSchema = z.object({
  username: usernameSchema,
  password: z.string().min(8).max(128),
  is_admin: z.boolean().optional(),
});

const patchMemberAdminSchema = z.object({
  is_admin: z.boolean(),
});

const patchPasswordSchema = z.object({
  current_password: z.string().min(8).max(128),
  new_password: z.string().min(8).max(128),
});

const adminResetPasswordSchema = z.object({
  new_password: z.string().min(8).max(128),
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

const refreshBodySchema = z.object({
  refreshToken: z.string().min(1).max(512),
});

const logoutBodySchema = z.object({
  refreshToken: z.string().min(1).max(512).optional(),
});

const dashboardEnvelopeOrderSchema = z.object({
  /** Every envelope id the user can see on the dashboard, in the desired order, each exactly once. */
  envelope_ids: z.array(z.number().int().positive()),
});

/** Apply saved per-user order; unknown envelopes keep the caller’s order (typically newest first). */
function sortEnvelopesByUserOrder<T extends { id: number }>(
  items: T[],
  orderJson: string | null | undefined
): T[] {
  if (orderJson == null || orderJson.trim() === "") return items;
  let parsed: unknown;
  try {
    parsed = JSON.parse(orderJson);
  } catch {
    return items;
  }
  if (!Array.isArray(parsed)) return items;
  const byId = new Map(items.map((e) => [e.id, e]));
  const validIds = new Set(items.map((e) => e.id));
  const seen = new Set<number>();
  const ordered: T[] = [];
  for (const raw of parsed) {
    if (typeof raw !== "number" || !Number.isInteger(raw)) continue;
    if (!validIds.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    const e = byId.get(raw);
    if (e) ordered.push(e);
  }
  for (const e of items) {
    if (!seen.has(e.id)) ordered.push(e);
  }
  return ordered;
}

/**
 * Edit: shared — admins any; standard users only if assigned to them.
 * Private — only the creator (owner_user_id is always the creator for private).
 */
function canEditEnvelope(
  user: { id: number; isAdmin: boolean },
  e: {
    user_id: number;
    owner_user_id: number | null;
    is_shared: number;
    assigned_user_id: number | null;
  }
): boolean {
  if (e.is_shared === 1) {
    if (user.isAdmin) return true;
    const assignee = e.assigned_user_id ?? e.user_id;
    return assignee === user.id;
  }
  const ownerId = e.owner_user_id ?? e.user_id;
  return ownerId === user.id;
}

/** Visible to everyone in household: shared, or private you created. Admins do not see others’ private. */
function envelopeVisibilityParams(
  householdId: number,
  userId: number
): [number, number] {
  return [householdId, userId];
}

const authRouteLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests; try again shortly." },
});

const registerRouteLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many registration attempts; try again shortly." },
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
      .prepare(
        "SELECT household_id, is_admin, username, token_version FROM users WHERE id = ?"
      )
      .get(payload.sub) as
      | {
          household_id: number | null;
          is_admin: number;
          username: string;
          token_version: number;
        }
      | undefined;
    if (!urow || urow.household_id == null) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if ((payload.tv ?? 0) !== urow.token_version) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    const householdId = urow.household_id;
    const isAdmin = urow.is_admin === 1;
    (req as AuthedRequest).user = attachUserFromToken(
      { ...payload, username: urow.username, householdId },
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

  r.post(
    "/api/auth/register",
    registerRouteLimiter,
    authRouteLimiter,
    async (req, res, next) => {
      try {
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

        if (inviteNorm !== undefined && !/^[a-f0-9]{12,64}$/.test(inviteNorm)) {
          res.status(400).json({ error: "Invite code must be 12-64 hex characters" });
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

        const hash = await bcrypt.hash(password, 12);
        try {
          const stmt = db.prepare(
            "INSERT INTO users (username, password_hash, household_id) VALUES (?, ?, ?)"
          );
          const info = stmt.run(userNorm, hash, householdId);
          const id = Number(info.lastInsertRowid);
          const token = signToken(id, userNorm, householdId, 0);
          const refreshToken = replaceUserRefreshTokens(db, id);
          res.status(201).json({
            token,
            refreshToken,
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
      } catch (err) {
        next(err);
      }
    }
  );

  r.post("/api/auth/login", authRouteLimiter, async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const { username, password } = parsed.data;
      const userNorm = username.trim().toLowerCase();
      const row = db
        .prepare(
          "SELECT id, username, password_hash, household_id, token_version FROM users WHERE username = ?"
        )
        .get(userNorm) as
        | {
            id: number;
            username: string;
            password_hash: string;
            household_id: number | null;
            token_version: number;
          }
        | undefined;
      if (!row || !(await bcrypt.compare(password, row.password_hash))) {
        res.status(401).json({ error: "Invalid username or password" });
        return;
      }
      if (row.household_id == null) {
        res.status(500).json({ error: "Account data incomplete" });
        return;
      }
      const token = signToken(
        row.id,
        row.username,
        row.household_id,
        row.token_version
      );
      const refreshToken = replaceUserRefreshTokens(db, row.id);
      res.json({
        token,
        refreshToken,
        user: userMePayload(db, row.id, row.username, row.household_id),
      });
    } catch (err) {
      next(err);
    }
  });

  r.post("/api/auth/refresh", authRouteLimiter, (req, res) => {
    const parsed = refreshBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const rotated = rotateRefreshToken(db, parsed.data.refreshToken);
    if (!rotated) {
      res.status(401).json({ error: "Invalid or expired refresh token" });
      return;
    }
    const urow = db
      .prepare("SELECT username, household_id, token_version FROM users WHERE id = ?")
      .get(rotated.userId) as
      | { username: string; household_id: number | null; token_version: number }
      | undefined;
    if (!urow?.household_id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const token = signToken(
      rotated.userId,
      urow.username,
      urow.household_id,
      urow.token_version
    );
    res.json({
      token,
      refreshToken: rotated.newRefreshPlain,
    });
  });

  r.post("/api/auth/logout", authRouteLimiter, (req, res) => {
    const parsed = logoutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    if (parsed.data.refreshToken) {
      revokeRefreshToken(db, parsed.data.refreshToken);
    }
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        const urow = db
          .prepare("SELECT token_version FROM users WHERE id = ?")
          .get(payload.sub) as { token_version: number } | undefined;
        if (urow && (payload.tv ?? 0) === urow.token_version) {
          db.prepare(
            "UPDATE users SET token_version = token_version + 1 WHERE id = ?"
          ).run(payload.sub);
          revokeAllRefreshTokensForUser(db, payload.sub);
        }
      }
    }
    res.status(204).end();
  });

  r.post("/api/admin/users", authMiddleware, async (req, res, next) => {
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
    const { username, password, is_admin: makeAdmin } = parsed.data;
    const userNorm = username.trim().toLowerCase();
    try {
      const hash = await bcrypt.hash(password, 12);
      const adminFlag = makeAdmin === true ? 1 : 0;
      try {
        const info = db
          .prepare(
            `INSERT INTO users (username, password_hash, household_id, is_admin)
            VALUES (?, ?, ?, ?)`
          )
          .run(userNorm, hash, user.householdId, adminFlag);
        const id = Number(info.lastInsertRowid);
        res.status(201).json({
          user: { id, username: userNorm, is_admin: adminFlag === 1 },
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
    } catch (err) {
      next(err);
    }
  });

  r.patch("/api/admin/users/:id", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    if (!user.isAdmin) {
      res.status(403).json({ error: "Only an administrator can change admin status." });
      return;
    }
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      res.status(400).json({ error: "Invalid user id." });
      return;
    }
    const parsed = patchMemberAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { is_admin: nextAdmin } = parsed.data;

    const target = db
      .prepare(
        "SELECT id, username, household_id, is_admin FROM users WHERE id = ?"
      )
      .get(targetId) as
      | {
          id: number;
          username: string;
          household_id: number | null;
          is_admin: number;
        }
      | undefined;

    if (!target || target.household_id !== user.householdId) {
      res.status(404).json({ error: "User not found in your household." });
      return;
    }

    const wasAdmin = target.is_admin === 1;
    if (wasAdmin && !nextAdmin) {
      const otherAdmins = db
        .prepare(
          `SELECT COUNT(*) AS n FROM users
           WHERE household_id = ? AND is_admin = 1 AND id != ?`
        )
        .get(user.householdId, targetId) as { n: number };
      if (otherAdmins.n === 0) {
        res.status(400).json({
          error:
            "The household must keep at least one administrator. Promote another user first.",
        });
        return;
      }
    }

    db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(
      nextAdmin ? 1 : 0,
      targetId
    );
    res.json({
      user: {
        id: targetId,
        username: target.username,
        is_admin: nextAdmin,
      },
    });
  });

  r.patch(
    "/api/admin/users/:id/password",
    authMiddleware,
    async (req, res, next) => {
      try {
        const { user } = req as AuthedRequest;
        if (!user.isAdmin) {
          res
            .status(403)
            .json({ error: "Only an administrator can reset passwords." });
          return;
        }
        const targetId = Number(req.params.id);
        if (!Number.isInteger(targetId) || targetId <= 0) {
          res.status(400).json({ error: "Invalid user id." });
          return;
        }
        const parsed = adminResetPasswordSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.flatten() });
          return;
        }
        const target = db
          .prepare("SELECT id, household_id FROM users WHERE id = ?")
          .get(targetId) as { id: number; household_id: number | null } | undefined;
        if (!target || target.household_id !== user.householdId) {
          res.status(404).json({ error: "User not found in your household." });
          return;
        }
        const hash = await bcrypt.hash(parsed.data.new_password, 12);
        db.prepare(
          "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?"
        ).run(hash, targetId);
        revokeAllRefreshTokensForUser(db, targetId);
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    }
  );

  r.get("/api/me", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    res.json({
      user: userMePayload(db, user.id, user.username, user.householdId),
    });
  });

  r.patch("/api/me/password", authMiddleware, async (req, res, next) => {
    try {
      const { user } = req as AuthedRequest;
      const parsed = patchPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const { current_password, new_password } = parsed.data;
      if (current_password === new_password) {
        res.status(400).json({
          error: "New password must be different from the current password.",
        });
        return;
      }
      const row = db
        .prepare("SELECT password_hash FROM users WHERE id = ?")
        .get(user.id) as { password_hash: string } | undefined;
      if (!row) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const ok = await bcrypt.compare(current_password, row.password_hash);
      if (!ok) {
        res.status(401).json({ error: "Current password is incorrect." });
        return;
      }
      const nextHash = await bcrypt.hash(new_password, 12);
      db.prepare(
        "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?"
      ).run(nextHash, user.id);
      revokeAllRefreshTokensForUser(db, user.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  r.put("/api/me/dashboard-envelope-order", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const parsed = dashboardEnvelopeOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const viewParams = envelopeVisibilityParams(user.householdId, user.id);
    const rows = db
      .prepare(
        `SELECT e.id FROM envelopes e WHERE e.household_id = ? AND (e.is_shared = 1 OR e.user_id = ?)`
      )
      .all(...viewParams) as { id: number }[];
    const visibleSet = new Set(rows.map((r) => r.id));
    const incoming = parsed.data.envelope_ids;
    if (incoming.length !== visibleSet.size) {
      res.status(400).json({
        error:
          "Order must list every envelope on your dashboard exactly once.",
      });
      return;
    }
    const incomingSet = new Set(incoming);
    if (incomingSet.size !== incoming.length) {
      res.status(400).json({ error: "Duplicate envelope ids in order." });
      return;
    }
    for (const id of incoming) {
      if (!visibleSet.has(id)) {
        res.status(400).json({ error: "Invalid envelope id in order." });
        return;
      }
    }
    db.prepare(
      "UPDATE users SET dashboard_envelope_order_json = ? WHERE id = ?"
    ).run(JSON.stringify(incoming), user.id);
    res.status(204).end();
  });

  r.patch("/api/household", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    if (!user.isAdmin) {
      res
        .status(403)
        .json({ error: "Only a household administrator can rename the household." });
      return;
    }
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

  r.post("/api/household/invite-code/regenerate", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    if (!user.isAdmin) {
      res.status(403).json({
        error: "Only a household administrator can regenerate invite codes.",
      });
      return;
    }
    let code = newInviteCode();
    for (let i = 0; i < 5; i += 1) {
      try {
        db.prepare("UPDATE households SET invite_code = ? WHERE id = ?").run(
          code,
          user.householdId
        );
        const household = householdPayload(db, user.householdId);
        res.json({ household });
        return;
      } catch (e: unknown) {
        if (
          e &&
          typeof e === "object" &&
          "code" in e &&
          e.code === "SQLITE_CONSTRAINT_UNIQUE"
        ) {
          code = newInviteCode();
          continue;
        }
        throw e;
      }
    }
    res.status(500).json({ error: "Could not regenerate invite code." });
  });

  r.get("/api/envelopes", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const viewParams = envelopeVisibilityParams(user.householdId, user.id);
    const envelopes = db
      .prepare(
        `SELECT e.id, e.name, e.user_id, e.owner_user_id, e.assigned_user_id,
          COALESCE(e.owner_user_id, e.user_id) AS owner_effective_id,
          e.opening_balance_cents, e.created_at, e.is_shared,
          uc.username AS created_by_username,
          uo.username AS owner_username,
          ua.username AS assigned_username,
          COALESCE(SUM(t.amount_cents), 0) AS tx_sum
        FROM envelopes e
        LEFT JOIN users uc ON uc.id = e.user_id
        LEFT JOIN users uo ON uo.id = COALESCE(e.owner_user_id, e.user_id)
        LEFT JOIN users ua ON ua.id = COALESCE(e.assigned_user_id, e.user_id)
        LEFT JOIN transactions t ON t.envelope_id = e.id
        WHERE e.household_id = ? AND (e.is_shared = 1 OR e.user_id = ?)
        GROUP BY e.id
        ORDER BY e.created_at DESC`
      )
      .all(...viewParams) as Array<{
        id: number;
        name: string;
        user_id: number;
        owner_user_id: number | null;
        assigned_user_id: number | null;
        owner_effective_id: number;
        opening_balance_cents: number;
        created_at: string;
        is_shared: number;
        created_by_username: string;
        owner_username: string;
        assigned_username: string;
        tx_sum: number;
      }>;

    const out = envelopes.map((e) => ({
      id: e.id,
      name: e.name,
      opening_balance_cents: e.opening_balance_cents,
      balance_cents: e.opening_balance_cents + e.tx_sum,
      created_at: e.created_at,
      shared_with_household: e.is_shared === 1,
      created_by_user_id: e.user_id,
      owner_user_id: e.owner_effective_id,
      created_by_username: e.created_by_username,
      owner_username: e.owner_username,
      assigned_user_id:
        e.is_shared === 1
          ? (e.assigned_user_id ?? e.user_id)
          : (e.owner_user_id ?? e.user_id),
      assigned_username:
        e.is_shared === 1 ? e.assigned_username : e.owner_username,
      can_edit: canEditEnvelope(user, {
        user_id: e.user_id,
        owner_user_id: e.owner_user_id,
        is_shared: e.is_shared,
        assigned_user_id: e.assigned_user_id,
      }),
    }));
    const orderRow = db
      .prepare(
        "SELECT dashboard_envelope_order_json FROM users WHERE id = ?"
      )
      .get(user.id) as
      | { dashboard_envelope_order_json: string | null }
      | undefined;
    const sorted = sortEnvelopesByUserOrder(
      out,
      orderRow?.dashboard_envelope_order_json ?? null
    );
    res.json({ envelopes: sorted });
  });

  r.post("/api/envelopes", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const parsed = envelopeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { name, opening_balance_cents, shared_with_household, assigned_user_id } =
      parsed.data;
    const shared =
      shared_with_household === undefined ? true : shared_with_household;
    const isShared = shared ? 1 : 0;

    let assignedIdSql: number | null = null;
    const ownerId = user.id;

    if (isShared === 1) {
      if (assigned_user_id !== undefined) {
        if (!user.isAdmin && assigned_user_id !== user.id) {
          res.status(403).json({
            error:
              "Only an administrator can assign a shared envelope to another user.",
          });
          return;
        }
        const member = db
          .prepare("SELECT id FROM users WHERE id = ? AND household_id = ?")
          .get(assigned_user_id, user.householdId) as { id: number } | undefined;
        if (!member) {
          res.status(400).json({
            error: "Assigned user must be a member of your household.",
          });
          return;
        }
        assignedIdSql = assigned_user_id;
      } else {
        assignedIdSql = user.id;
      }
    } else {
      if (assigned_user_id !== undefined) {
        res.status(400).json({
          error: "assigned_user_id applies only to shared envelopes.",
        });
        return;
      }
    }

    const info = db
      .prepare(
        `INSERT INTO envelopes (user_id, household_id, name, opening_balance_cents, is_shared, owner_user_id, assigned_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        user.id,
        user.householdId,
        name,
        opening_balance_cents,
        isShared,
        ownerId,
        assignedIdSql
      );
    const id = Number(info.lastInsertRowid);
    const ownerRow = db
      .prepare("SELECT username FROM users WHERE id = ?")
      .get(ownerId) as { username: string } | undefined;
    const ownerUsername = ownerRow?.username ?? user.username;
    const assigneeForShared =
      isShared === 1 ? (assignedIdSql ?? user.id) : ownerId;
    const assigneeRow = db
      .prepare("SELECT username FROM users WHERE id = ?")
      .get(assigneeForShared) as { username: string } | undefined;
    res.status(201).json({
      envelope: {
        id,
        name,
        opening_balance_cents,
        balance_cents: opening_balance_cents,
        created_at: new Date().toISOString(),
        shared_with_household: shared,
        created_by_user_id: user.id,
        owner_user_id: ownerId,
        created_by_username: user.username,
        owner_username: ownerUsername,
        assigned_user_id: assigneeForShared,
        assigned_username: assigneeRow?.username ?? user.username,
        can_edit: true,
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
    const viewParams = [id, ...envelopeVisibilityParams(user.householdId, user.id)];
    const row = db
      .prepare(
        `SELECT e.id, e.name, e.user_id, e.owner_user_id, e.assigned_user_id,
          COALESCE(e.owner_user_id, e.user_id) AS owner_effective_id,
          e.opening_balance_cents, e.created_at, e.is_shared,
          uc.username AS created_by_username,
          uo.username AS owner_username,
          ua.username AS assigned_username,
          COALESCE(SUM(t.amount_cents), 0) AS tx_sum
        FROM envelopes e
        LEFT JOIN users uc ON uc.id = e.user_id
        LEFT JOIN users uo ON uo.id = COALESCE(e.owner_user_id, e.user_id)
        LEFT JOIN users ua ON ua.id = COALESCE(e.assigned_user_id, e.user_id)
        LEFT JOIN transactions t ON t.envelope_id = e.id
        WHERE e.id = ? AND e.household_id = ? AND (e.is_shared = 1 OR e.user_id = ?)
        GROUP BY e.id`
      )
      .get(...viewParams) as
      | {
          id: number;
          name: string;
          user_id: number;
          owner_user_id: number | null;
          assigned_user_id: number | null;
          owner_effective_id: number;
          opening_balance_cents: number;
          created_at: string;
          is_shared: number;
          created_by_username: string;
          owner_username: string;
          assigned_username: string;
          tx_sum: number;
        }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "Envelope not found" });
      return;
    }
    const canEdit = canEditEnvelope(user, {
      user_id: row.user_id,
      owner_user_id: row.owner_user_id,
      is_shared: row.is_shared,
      assigned_user_id: row.assigned_user_id,
    });
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
        created_by_user_id: row.user_id,
        owner_user_id: row.owner_effective_id,
        created_by_username: row.created_by_username,
        owner_username: row.owner_username,
        assigned_user_id:
          row.is_shared === 1
            ? (row.assigned_user_id ?? row.user_id)
            : row.owner_effective_id,
        assigned_username:
          row.is_shared === 1 ? row.assigned_username : row.owner_username,
        can_edit: canEdit,
      },
      transactions,
    });
  });

  r.patch("/api/envelopes/:id", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = envelopePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const viewParams = [id, ...envelopeVisibilityParams(user.householdId, user.id)];

    type PatchRow = {
      id: number;
      name: string;
      user_id: number;
      owner_user_id: number | null;
      assigned_user_id: number | null;
      opening_balance_cents: number;
      created_at: string;
      is_shared: number;
      tx_sum: number;
    };

    let row = db
      .prepare(
        `SELECT e.id, e.name, e.user_id, e.owner_user_id, e.assigned_user_id, e.opening_balance_cents, e.created_at, e.is_shared,
          COALESCE(SUM(t.amount_cents), 0) AS tx_sum
        FROM envelopes e
        LEFT JOIN transactions t ON t.envelope_id = e.id
        WHERE e.id = ? AND e.household_id = ? AND (e.is_shared = 1 OR e.user_id = ?)
        GROUP BY e.id`
      )
      .get(...viewParams) as PatchRow | undefined;
    if (!row) {
      res.status(404).json({ error: "Envelope not found" });
      return;
    }

    const wantAssigned = parsed.data.assigned_user_id !== undefined;
    const wantShared = parsed.data.shared_with_household !== undefined;
    const wantNameOrBalance =
      parsed.data.name !== undefined || parsed.data.current_balance_cents !== undefined;

    if (wantShared) {
      if (!canEditEnvelope(user, row)) {
        res.status(403).json({
          error: "You don't have permission to change sharing for this envelope.",
        });
        return;
      }
      const isShared = parsed.data.shared_with_household ? 1 : 0;
      db.prepare(
        `UPDATE envelopes SET is_shared = ? WHERE id = ? AND household_id = ?`
      ).run(isShared, id, user.householdId);
      if (isShared === 0) {
        db.prepare(
          `UPDATE envelopes SET owner_user_id = user_id, assigned_user_id = NULL WHERE id = ? AND household_id = ?`
        ).run(id, user.householdId);
      } else {
        db.prepare(
          `UPDATE envelopes SET assigned_user_id = COALESCE(assigned_user_id, user_id) WHERE id = ? AND household_id = ?`
        ).run(id, user.householdId);
      }
      row = db
        .prepare(
          `SELECT e.id, e.name, e.user_id, e.owner_user_id, e.assigned_user_id, e.opening_balance_cents, e.created_at, e.is_shared,
            COALESCE(SUM(t.amount_cents), 0) AS tx_sum
          FROM envelopes e
          LEFT JOIN transactions t ON t.envelope_id = e.id
          WHERE e.id = ? AND e.household_id = ?
          GROUP BY e.id`
        )
        .get(id, user.householdId) as PatchRow | undefined;
      if (!row) {
        res.status(500).json({ error: "Could not load envelope" });
        return;
      }
    }

    if (wantAssigned) {
      if (!user.isAdmin) {
        res.status(403).json({
          error:
            "Only an administrator can change who is assigned to a shared envelope.",
        });
        return;
      }
      if (row.is_shared !== 1) {
        res.status(400).json({
          error: "Assignment applies only to shared envelopes.",
        });
        return;
      }
      const newAssignee = parsed.data.assigned_user_id!;
      const member = db
        .prepare("SELECT id FROM users WHERE id = ? AND household_id = ?")
        .get(newAssignee, user.householdId) as { id: number } | undefined;
      if (!member) {
        res.status(400).json({ error: "User is not in this household." });
        return;
      }
      db.prepare(
        `UPDATE envelopes SET assigned_user_id = ? WHERE id = ? AND household_id = ?`
      ).run(newAssignee, id, user.householdId);
      row = db
        .prepare(
          `SELECT e.id, e.name, e.user_id, e.owner_user_id, e.assigned_user_id, e.opening_balance_cents, e.created_at, e.is_shared,
            COALESCE(SUM(t.amount_cents), 0) AS tx_sum
          FROM envelopes e
          LEFT JOIN transactions t ON t.envelope_id = e.id
          WHERE e.id = ? AND e.household_id = ?
          GROUP BY e.id`
        )
        .get(id, user.householdId) as PatchRow | undefined;
      if (!row) {
        res.status(500).json({ error: "Could not load envelope" });
        return;
      }
    }

    if (wantNameOrBalance) {
      if (parsed.data.name !== undefined && !canEditEnvelope(user, row)) {
        res.status(403).json({
          error: "You don't have permission to edit this envelope.",
        });
        return;
      }
      if (parsed.data.current_balance_cents !== undefined) {
        if (!user.isAdmin) {
          res.status(403).json({
            error:
              "Only an administrator can set the balance without recording transactions.",
          });
          return;
        }
      }
      let newName = row.name;
      if (parsed.data.name !== undefined) {
        newName = parsed.data.name.trim();
      }
      let newOpening = row.opening_balance_cents;
      if (parsed.data.current_balance_cents !== undefined) {
        newOpening = parsed.data.current_balance_cents - row.tx_sum;
      }
      db.prepare(
        `UPDATE envelopes SET name = ?, opening_balance_cents = ? WHERE id = ? AND household_id = ?`
      ).run(newName, newOpening, id, user.householdId);
    }

    const out = db
      .prepare(
        `SELECT e.id, e.name, e.user_id, e.owner_user_id, e.assigned_user_id,
          COALESCE(e.owner_user_id, e.user_id) AS owner_effective_id,
          e.opening_balance_cents, e.created_at, e.is_shared,
          uc.username AS created_by_username,
          uo.username AS owner_username,
          ua.username AS assigned_username,
          COALESCE(SUM(t.amount_cents), 0) AS tx_sum
        FROM envelopes e
        LEFT JOIN users uc ON uc.id = e.user_id
        LEFT JOIN users uo ON uo.id = COALESCE(e.owner_user_id, e.user_id)
        LEFT JOIN users ua ON ua.id = COALESCE(e.assigned_user_id, e.user_id)
        LEFT JOIN transactions t ON t.envelope_id = e.id
        WHERE e.id = ? AND e.household_id = ?
        GROUP BY e.id`
      )
      .get(id, user.householdId) as
      | {
          id: number;
          name: string;
          user_id: number;
          owner_user_id: number | null;
          assigned_user_id: number | null;
          owner_effective_id: number;
          opening_balance_cents: number;
          created_at: string;
          is_shared: number;
          created_by_username: string;
          owner_username: string;
          assigned_username: string;
          tx_sum: number;
        }
      | undefined;
    if (!out) {
      res.status(500).json({ error: "Could not load envelope" });
      return;
    }
    res.json({
      envelope: {
        id: out.id,
        name: out.name,
        opening_balance_cents: out.opening_balance_cents,
        balance_cents: out.opening_balance_cents + out.tx_sum,
        created_at: out.created_at,
        shared_with_household: out.is_shared === 1,
        created_by_user_id: out.user_id,
        owner_user_id: out.owner_effective_id,
        created_by_username: out.created_by_username,
        owner_username: out.owner_username,
        assigned_user_id:
          out.is_shared === 1
            ? (out.assigned_user_id ?? out.user_id)
            : out.owner_effective_id,
        assigned_username:
          out.is_shared === 1 ? out.assigned_username : out.owner_username,
        can_edit: canEditEnvelope(user, {
          user_id: out.user_id,
          owner_user_id: out.owner_user_id,
          is_shared: out.is_shared,
          assigned_user_id: out.assigned_user_id,
        }),
      },
    });
  });

  r.delete("/api/envelopes/:id", authMiddleware, (req, res) => {
    const { user } = req as AuthedRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const viewParams = [id, ...envelopeVisibilityParams(user.householdId, user.id)];
    const row = db
      .prepare(
        `SELECT e.user_id, e.owner_user_id, e.assigned_user_id, e.is_shared FROM envelopes e
         WHERE e.id = ? AND e.household_id = ? AND (e.is_shared = 1 OR e.user_id = ?)`
      )
      .get(...viewParams) as
      | {
          user_id: number;
          owner_user_id: number | null;
          assigned_user_id: number | null;
          is_shared: number;
        }
      | undefined;
    if (!row) {
      res.status(404).json({ error: "Envelope not found" });
      return;
    }
    if (!canEditEnvelope(user, row)) {
      res.status(403).json({
        error: "You don't have permission to delete this envelope.",
      });
      return;
    }
    const info = db
      .prepare(`DELETE FROM envelopes WHERE id = ? AND household_id = ?`)
      .run(id, user.householdId);
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
    const viewParams = [id, ...envelopeVisibilityParams(user.householdId, user.id)];
    const env = db
      .prepare(
        `SELECT e.id, e.user_id, e.owner_user_id, e.assigned_user_id, e.is_shared FROM envelopes e
         WHERE e.id = ? AND e.household_id = ? AND (e.is_shared = 1 OR e.user_id = ?)`
      )
      .get(...viewParams) as
      | {
          id: number;
          user_id: number;
          owner_user_id: number | null;
          assigned_user_id: number | null;
          is_shared: number;
        }
      | undefined;
    if (!env) {
      res.status(404).json({ error: "Envelope not found" });
      return;
    }
    if (!canEditEnvelope(user, env)) {
      res.status(403).json({
        error: "You don't have permission to add transactions to this envelope.",
      });
      return;
    }
    const parsed = transactionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { amount_cents, type, note } = parsed.data;
    const createdAt = normalizeOptionalCreatedAt(parsed.data.created_at);
    if (parsed.data.created_at !== undefined && parsed.data.created_at !== "" && !createdAt) {
      res.status(400).json({ error: "Invalid created_at" });
      return;
    }
    const signed = type === "flow" ? amount_cents : -amount_cents;
    const info = createdAt
      ? db
          .prepare(
            `INSERT INTO transactions (user_id, envelope_id, amount_cents, note, created_at)
            VALUES (?, ?, ?, ?, ?)`
          )
          .run(user.id, id, signed, note, createdAt)
      : db
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
    const inserted = db
      .prepare(
        "SELECT id, amount_cents, note, created_at FROM transactions WHERE id = ?"
      )
      .get(txId) as {
      id: number;
      amount_cents: number;
      note: string | null;
      created_at: string;
    };
    res.status(201).json({
      transaction: {
        id: inserted.id,
        amount_cents: inserted.amount_cents,
        note: inserted.note,
        created_at: inserted.created_at,
      },
      balance_cents: envRow.opening_balance_cents + sumRow.s,
    });
  });

  function transactionCanBeMutatedByUser(
    txId: number,
    envelopeId: number,
    user: AuthedRequest["user"]
  ): boolean {
    const row = db
      .prepare(
        `SELECT t.id, t.user_id AS tx_user_id, e.user_id, e.owner_user_id, e.assigned_user_id, e.is_shared FROM transactions t
         JOIN envelopes e ON e.id = t.envelope_id
         WHERE t.id = ? AND t.envelope_id = ? AND e.household_id = ?
           AND (e.is_shared = 1 OR e.user_id = ?)`
      )
      .get(txId, envelopeId, user.householdId, user.id) as
      | {
          id: number;
          tx_user_id: number;
          user_id: number;
          owner_user_id: number | null;
          assigned_user_id: number | null;
          is_shared: number;
        }
      | undefined;
    if (!row) return false;
    const viewOk =
      row.is_shared === 1 || row.user_id === user.id;
    if (!viewOk) return false;
    if (!canEditEnvelope(user, row)) return false;
    return user.isAdmin || row.tx_user_id === user.id;
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
      if (!transactionCanBeMutatedByUser(txId, envelopeId, user)) {
        res.status(404).json({ error: "Transaction not found" });
        return;
      }
      const parsed = transactionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const { amount_cents, type, note } = parsed.data;
      const createdAt = normalizeOptionalCreatedAt(parsed.data.created_at);
      if (parsed.data.created_at !== undefined && parsed.data.created_at !== "" && !createdAt) {
        res.status(400).json({ error: "Invalid created_at" });
        return;
      }
      const signed = type === "flow" ? amount_cents : -amount_cents;
      if (createdAt !== undefined) {
        db.prepare(
          `UPDATE transactions SET amount_cents = ?, note = ?, created_at = ? WHERE id = ? AND envelope_id = ?`
        ).run(signed, note, createdAt, txId, envelopeId);
      } else {
        db.prepare(
          `UPDATE transactions SET amount_cents = ?, note = ? WHERE id = ? AND envelope_id = ?`
        ).run(signed, note, txId, envelopeId);
      }
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
      if (!transactionCanBeMutatedByUser(txId, envelopeId, user)) {
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

  function getEditableEnvelopeId(
    user: AuthedRequest["user"],
    envelopeId: number
  ): { id: number } | undefined {
    const viewParams = [
      envelopeId,
      ...envelopeVisibilityParams(user.householdId, user.id),
    ];
    const row = db
      .prepare(
        `SELECT e.id, e.user_id, e.owner_user_id, e.assigned_user_id, e.is_shared FROM envelopes e
         WHERE e.id = ? AND e.household_id = ? AND (e.is_shared = 1 OR e.user_id = ?)`
      )
      .get(...viewParams) as
      | {
          id: number;
          user_id: number;
          owner_user_id: number | null;
          assigned_user_id: number | null;
          is_shared: number;
        }
      | undefined;
    if (!row || !canEditEnvelope(user, row)) return undefined;
    return { id: row.id };
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
    if (!getEditableEnvelopeId(user, envelope_id)) {
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
    if (!getEditableEnvelopeId(user, nextEnvelopeId)) {
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
