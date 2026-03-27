import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { openDb, getDbPath } from "./db.js";
import { createRouter } from "./routes.js";
import { runDueSchedules } from "./schedule.js";
import { seedAdminFromEnv } from "./seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Default dotenv only reads `cwd/.env`; dev often runs from `server/` so root `.env` is missed.
const envAtRepoRoot = path.resolve(__dirname, "..", "..", ".env");
const envAtServer = path.resolve(__dirname, "..", ".env");
dotenv.config({ path: envAtRepoRoot });
dotenv.config({ path: envAtServer });
dotenv.config();
const PORT = Number(process.env.PORT) || 4000;

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
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? true,
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

app.listen(PORT, () => {
  console.log(`Envelope budget API listening on port ${PORT}`);
  console.log(`Database: ${getDbPath()}`);
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
