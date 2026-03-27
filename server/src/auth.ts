import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "./config.js";

export type JwtPayload = {
  sub: number;
  username: string;
  /** Present on new tokens; legacy tokens may use `email` */
  householdId?: number;
  tv?: number;
};

function payloadUsername(decoded: object): string | null {
  const u = (decoded as { username?: unknown }).username;
  if (typeof u === "string" && u.length > 0) return u;
  const legacy = (decoded as { email?: unknown }).email;
  if (typeof legacy === "string" && legacy.length > 0) return legacy;
  return null;
}

export function signToken(
  userId: number,
  username: string,
  householdId: number,
  tokenVersion: number
): string {
  return jwt.sign({ sub: userId, username, householdId, tv: tokenVersion }, JWT_SECRET, {
    expiresIn: "4h",
  });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (typeof decoded === "object" && decoded !== null && "sub" in decoded) {
      const sub = (decoded as { sub: unknown }).sub;
      const id =
        typeof sub === "number"
          ? sub
          : typeof sub === "string"
            ? Number(sub)
            : NaN;
      const username = payloadUsername(decoded);
      const hid = (decoded as { householdId?: unknown }).householdId;
      const householdId =
        typeof hid === "number" && Number.isFinite(hid)
          ? hid
          : typeof hid === "string" && /^\d+$/.test(hid)
            ? Number(hid)
            : undefined;
      const tv = (decoded as { tv?: unknown }).tv;
      const tokenVersion =
        typeof tv === "number" && Number.isInteger(tv) && tv >= 0
          ? tv
          : typeof tv === "string" && /^\d+$/.test(tv)
            ? Number(tv)
            : 0;
      if (Number.isFinite(id) && username) {
        return { sub: id, username, householdId, tv: tokenVersion };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export type AuthedRequest = Request & {
  user: { id: number; username: string; householdId: number; isAdmin: boolean };
};

export function attachUserFromToken(
  payload: JwtPayload,
  householdId: number,
  isAdmin: boolean
): AuthedRequest["user"] {
  return {
    id: payload.sub,
    username: payload.username,
    householdId,
    isAdmin,
  };
}
