import "./config.js";
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb, getDbPath } from "./db.js";
import { createRouter } from "./routes.js";
import { runDueSchedules } from "./schedule.js";
import { seedAdminFromEnv } from "./seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;

if (process.env.ALLOW_OPEN_REGISTRATION === "true") {
  console.warn(
    "SECURITY WARNING: ALLOW_OPEN_REGISTRATION is enabled. Anyone can create accounts and households. Use only in trusted development environments; disable in production."
  );
}

const db = openDb();
seedAdminFromEnv(db);
const userCount = (
  db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }
).c;
if (
  userCount === 0 &&
  !process.env.ADMIN_USERNAME &&
  !process.env.ADMIN_EMAIL
) {
  console.warn(
    "No users in the database. Set ADMIN_USERNAME and ADMIN_PASSWORD (and restart) to create the first admin, or set ALLOW_OPEN_REGISTRATION=true for development only."
  );
}
const app = express();

const corsOriginRaw = process.env.CORS_ORIGIN;
const corsOrigin: boolean | string | string[] =
  corsOriginRaw === undefined || corsOriginRaw === ""
    ? false
    : corsOriginRaw.includes(",")
      ? corsOriginRaw.split(",").map((s) => s.trim())
      : corsOriginRaw;

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
      },
    },
  })
);
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: "256kb" }));
app.use(createRouter(db));

const staticDir = path.join(__dirname, "..", "public");
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(staticDir, "index.html"));
  });
}
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error("Unhandled server error:", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Envelope budget API listening on port ${PORT}`);
  console.log(`Database: ${getDbPath()}`);
  if (corsOrigin === false) {
    console.log(
      "CORS: disabled (same-origin only). Set CORS_ORIGIN to allow other browser origins."
    );
  }
});

/** Run monthly schedules on an interval (server local date). */
const SCHEDULE_TICK_MS = 60_000;
setInterval(() => {
  try {
    runDueSchedules(db);
  } catch (e) {
    console.error("Scheduled transactions:", e);
  }
}, SCHEDULE_TICK_MS);
setTimeout(() => {
  try {
    runDueSchedules(db);
  } catch (e) {
    console.error("Scheduled transactions (startup):", e);
  }
}, 10_000);
