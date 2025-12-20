// cli/src/config.ts
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

/**
 * Load CLI config from:
 *  1) nearest .infinitysnaprc found by walking up from cwd
 *  2) then fall back to default dotenv loading (.env in cwd if present)
 *
 * This removes the need to export env vars each time.
 */
function loadCliEnvOnce() {
  // Prevent double-load if imported multiple times
  if ((globalThis as any).__INFINITYSNAP_ENV_LOADED__) return;
  (globalThis as any).__INFINITYSNAP_ENV_LOADED__ = true;

  // Walk up from CWD to filesystem root
  let dir = process.cwd();
  while (true) {
    const rcPath = path.join(dir, ".infinitysnaprc");
    if (fs.existsSync(rcPath)) {
      dotenv.config({ path: rcPath });
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Also load a local .env if user has one (optional)
  dotenv.config();
}

loadCliEnvOnce();

function trimSlashEnd(s: string) {
  return String(s || "").replace(/\/+$/, "");
}

function ensureApiV1(base: string) {
  const b = trimSlashEnd(String(base || "").trim());
  if (!b) return "";
  if (/\/api\/v1$/i.test(b)) return b;
  return `${b}/api/v1`;
}

/**
 * Accepted env vars (highest priority first):
 * - INFINITYSNAP_API         -> full base including /api/v1 or root (we normalize)
 * - INFINITYSNAP_BACKEND_URL -> root backend url (we append /api/v1)
 * - INFINITY_BACKEND_URL     -> root backend url (we append /api/v1)
 * - BACKEND_URL              -> root backend url (we append /api/v1)
 */
export const API_BASE = ensureApiV1(
  trimSlashEnd(
    process.env.INFINITYSNAP_API ||
      process.env.INFINITYSNAP_BACKEND_URL ||
      process.env.INFINITY_BACKEND_URL ||
      process.env.BACKEND_URL ||
      "http://localhost:4000"
  )
);

export const DASHBOARD_URL = trimSlashEnd(
  (process.env.INFINITYSNAP_DASHBOARD_URL || "").trim() || "http://localhost:3000"
);

/**
 * CLI API key:
 * - INFINITYSNAP_API_KEY is the user-facing name
 * - BACKEND_API_KEY works too (matches backend naming)
 */
export const API_KEY =
  (process.env.INFINITYSNAP_API_KEY || "").trim() ||
  (process.env.BACKEND_API_KEY || "").trim() ||
  "";

export function baseNoApiV1(url: string) {
  return trimSlashEnd(String(url || "")).replace(/\/api\/v1$/i, "");
}
