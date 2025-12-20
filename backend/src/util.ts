// backend/src/util.ts
import fs from "fs/promises";
import path from "path";

/**
 * Root runtime directory for InfinitySnap
 *
 * All ephemeral and generated data lives here.
 * This folder should NOT be committed to git.
 *
 * backend/.data/
 */
export const DATA_ROOT = path.join(__dirname, "..", ".data");

export const SANDBOX_DIR = path.join(DATA_ROOT, "sandbox");
export const LOGS_DIR = path.join(DATA_ROOT, "logs");
export const DIFFS_DIR = path.join(DATA_ROOT, "diffs");
export const METRICS_DIR = path.join(DATA_ROOT, "metrics");
export const RUNS_DIR = path.join(DATA_ROOT, "runs");
export const PATCHES_DIR = path.join(DATA_ROOT, "patches");

// allow override so you can put artifacts on a mounted volume in prod
export const ARTIFACTS_DIR =
  process.env.ARTIFACTS_DIR || path.join(DATA_ROOT, "artifacts");

/**
 * Ensure all runtime directories exist.
 * Safe to call multiple times.
 */
export async function ensureDataDirs(): Promise<void> {
  const dirs = [
    DATA_ROOT,
    SANDBOX_DIR,
    LOGS_DIR,
    DIFFS_DIR,
    METRICS_DIR,
    RUNS_DIR,
    PATCHES_DIR,
    ARTIFACTS_DIR,
  ];

  // allSettled = more demo-proof (won't crash on one mkdir failure)
  const results = await Promise.allSettled(
    dirs.map((d) => fs.mkdir(d, { recursive: true }))
  );

  const failed = results
    .map((r, i) => ({ r, dir: dirs[i] }))
    .filter((x) => x.r.status === "rejected");

  if (failed.length) {
    // Still throw so you notice the issue early,
    // but with clearer context.
    const msgs = failed
      .map((f) => `mkdir failed: ${f.dir} → ${(f.r as any).reason?.message || f.r}`)
      .join("\n");
    throw new Error(msgs);
  }
}

/**
 * Create a temporary sandbox directory for InfinitySnap.
 * Stored under:
 *   backend/.data/sandbox/snap-XXXXXX
 */
export async function makeTempDir(prefix = "snap"): Promise<string> {
  await ensureDataDirs();
  const tmpBase = path.join(SANDBOX_DIR, `${prefix}-`);
  return fs.mkdtemp(tmpBase);
}

/**
 * Utility to generate a stable run ID
 * Used by backend + CLI + dashboard
 */
export function generateRunId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Optional helper: resolve a path and ensure it stays inside baseDir
 */
export function resolveInside(baseDir: string, target: string): string {
  const base = path.resolve(baseDir);
  const full = path.resolve(baseDir, target);
  if (!full.startsWith(base + path.sep) && full !== base) {
    throw new Error("path escapes base directory");
  }
  return full;
}
