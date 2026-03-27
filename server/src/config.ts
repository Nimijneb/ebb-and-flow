import "./loadEnv.js";

const s = process.env.JWT_SECRET;
if (!s || s.length < 32) {
  console.error(
    "FATAL: JWT_SECRET must be set in the environment and be at least 32 characters long."
  );
  process.exit(1);
}

/** HS256 secret; validated at startup — never use a default in production. */
export const JWT_SECRET = s;
