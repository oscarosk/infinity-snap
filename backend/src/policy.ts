// backend/src/policy.ts
/**
 * Central policy for InfinitySnap
 * - Judge-safe: no silent dangerous behavior
 * - Deterministic: rules are explicit and testable
 * - Small + fast: only string checks (no heavy deps)
 */

export type PolicyDecision =
  | { ok: true }
  | { ok: false; code: string; reason: string };

function deny(code: string, reason: string): PolicyDecision {
  return { ok: false, code, reason };
}

export const POLICY = {
  // Hard limits (protect server)
  MAX_COMMAND_LEN: Number(process.env.MAX_COMMAND_LEN || 400),
  MAX_LOG_BYTES: Number(process.env.MAX_LOG_BYTES || 2_000_000), // 2MB
  MAX_PATCH_FILES: Number(process.env.MAX_PATCH_FILES || 12),

  // If true, we refuse dangerous commands (recommended for demos)
  STRICT_COMMAND_POLICY:
    (process.env.STRICT_COMMAND_POLICY || "true").toLowerCase() === "true",

  // Commands that are allowed as a base (optional; leave empty to allow most non-dangerous)
  // Example: "npm test", "pnpm test", "pytest", "go test ./..."
  ALLOWLIST_PREFIXES: (process.env.ALLOWLIST_PREFIXES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  // Always blocked patterns (even if allowlisted)
  // These are conservative “don’t brick a machine” protections.
  DENY_PATTERNS: [
    /\brm\s+-rf\b/i,
    /\bdel\s+\/s\b/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /\bmkfs\b/i,
    /\bdd\s+if=\b/i,
    /\bformat\b/i,
    /\bpoweroff\b/i,
    /\bkill\s+-9\s+1\b/i,

    // file exfil / creds
    /\bcat\s+~\/\.ssh\b/i,
    /\bcat\s+\/etc\/shadow\b/i,
    /\bprintenv\b/i,
    /\benv\b/i,

    // network tools (optional; keep strict for judge environments)
    /\bcurl\b/i,
    /\bwget\b/i,
    /\bnc\b|\bnetcat\b/i,
  ],
} as const;

/**
 * Validate a command before running in sandbox.
 * If STRICT_COMMAND_POLICY=false, we still enforce size + deny patterns.
 */
export function checkCommand(command: string): PolicyDecision {
  const c = (command || "").trim();
  if (!c) return deny("EMPTY_COMMAND", "Command is empty.");
  if (c.length > POLICY.MAX_COMMAND_LEN) {
    return deny(
      "COMMAND_TOO_LONG",
      `Command exceeds ${POLICY.MAX_COMMAND_LEN} chars.`
    );
  }

  for (const re of POLICY.DENY_PATTERNS) {
    if (re.test(c)) {
      return deny("COMMAND_BLOCKED", `Command blocked by policy: ${re}`);
    }
  }

  if (POLICY.STRICT_COMMAND_POLICY && POLICY.ALLOWLIST_PREFIXES.length) {
    const ok = POLICY.ALLOWLIST_PREFIXES.some((p) => c.startsWith(p));
    if (!ok) {
      return deny(
        "COMMAND_NOT_ALLOWLISTED",
        `Command not allowed. Allowed prefixes: ${POLICY.ALLOWLIST_PREFIXES.join(
          ", "
        )}`
      );
    }
  }

  return { ok: true };
}

/**
 * Validate patch file paths before applying.
 * Judge-safe: blocks traversal, absolute paths, infra dirs, sensitive files.
 */
export function checkPatchPaths(paths: string[]): PolicyDecision {
  if (!Array.isArray(paths))
    return deny("BAD_PATCH", "Patch paths must be an array.");
  if (paths.length > POLICY.MAX_PATCH_FILES) {
    return deny(
      "PATCH_TOO_LARGE",
      `Too many files in patch (max ${POLICY.MAX_PATCH_FILES}).`
    );
  }

  for (const raw of paths) {
    if (typeof raw !== "string" || !raw.trim()) {
      return deny(
        "BAD_PATCH_PATH",
        "Patch contains empty/non-string path."
      );
    }

    // Normalize separators to avoid bypasses like "..\\.."
    const p = raw.trim().replace(/\\/g, "/");

    // Block absolute paths + Windows drive paths (C:/...)
    if (p.startsWith("/") || /^[A-Za-z]:\//.test(p)) {
      return deny("PATCH_PATH_BLOCKED", `Patch path not allowed: ${raw}`);
    }

    // Block traversal anywhere
    if (p.includes("..")) {
      return deny("PATCH_PATH_BLOCKED", `Patch path not allowed: ${raw}`);
    }

    // Block hidden repo/infra or sensitive zones (tight for judges)
    const blockedPrefixes = [
      ".git/",
      ".github/",
      ".gitlab/",
      ".circleci/",
      ".vscode/",
      "scripts/", // prevents modifying executor
      "backend/.data/", // prevents tampering with stored runs/logs
    ];
    if (blockedPrefixes.some((bp) => p === bp.slice(0, -1) || p.startsWith(bp))) {
      return deny(
        "PATCH_INFRA_BLOCKED",
        `Patch targets restricted path: ${raw}`
      );
    }

    // Block sensitive filenames anywhere
    const blockedContains = [
      ".env",
      ".ssh",
      "id_rsa",
      "id_ed25519",
      "authorized_keys",
      "known_hosts",
      ".npmrc",
      ".pypirc",
      "secrets",
      "token",
      "credentials",
    ];
    if (blockedContains.some((s) => p.toLowerCase().includes(s))) {
      return deny(
        "PATCH_SENSITIVE_FILE",
        `Patch targets sensitive file: ${raw}`
      );
    }

    // Optional: block docker / compose edits if you want ultra-safe
    if (/(^|\/)dockerfile$/i.test(p) || /docker-compose\.ya?ml$/i.test(p)) {
      return deny("PATCH_INFRA_BLOCKED", `Patch targets infra file: ${raw}`);
    }
  }

  return { ok: true };
}

/**
 * Truncate logs to prevent huge responses / disk bloat.
 */
export function clampLog(text: string): string {
  const s = String(text || "");
  const max = POLICY.MAX_LOG_BYTES;
  if (Buffer.byteLength(s, "utf8") <= max) return s;

  // Keep tail (often contains the error)
  const tail = s.slice(Math.max(0, s.length - max));
  return `... (truncated to last ${max} bytes)\n` + tail;
}
