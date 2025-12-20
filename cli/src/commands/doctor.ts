// cli/src/commands/doctor.ts
import axios from "axios";
import chalk from "chalk";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { API_BASE, baseNoApiV1 } from "../config";
import {
  printHeader,
  section,
  ok,
  warn,
  err,
  kv,
  box,
  badge,
  spacer,
} from "../ui/render";

type Tone = "muted" | "info" | "ok" | "warn" | "err";

function isTruthy(v: string | undefined) {
  return !!String(v || "").trim();
}

function maskSecret(s: string) {
  const v = String(s || "").trim();
  if (!v) return "(missing)";
  if (v.length <= 8) return "********";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

function tryCmd(cmd: string): string | null {
  try {
    const out = execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim();
  } catch {
    return null;
  }
}

function hasCommand(cmd: string): boolean {
  return tryCmd(`command -v ${cmd}`) !== null;
}

async function pingOk(
  url: string,
  timeoutMs = 2500
): Promise<{ ok: boolean; status?: number }> {
  try {
    const r = await axios.get(url, {
      timeout: timeoutMs,
      validateStatus: () => true,
    });
    const ok2xx = r.status >= 200 && r.status < 300;
    return { ok: ok2xx, status: r.status };
  } catch {
    return { ok: false };
  }
}

async function checkEndpoint(name: string, url: string): Promise<boolean> {
  const r = await pingOk(url);
  if (r.ok) {
    ok(`${name}: OK`);
    return true;
  }
  if (r.status) {
    warn(`${name}: responded (${r.status})`);
    return false;
  }
  err(`${name}: NOT reachable`);
  return false;
}

function detectShellRcFiles(): string[] {
  const home = process.env.HOME || "";
  const candidates = [
    ".bashrc",
    ".zshrc",
    ".profile",
    ".bash_profile",
    ".config/fish/config.fish",
  ];
  return candidates
    .map((f) => (home ? path.join(home, f) : ""))
    .filter(Boolean);
}

function detectRuntimeContext() {
  const isWsl =
    !!process.env.WSL_DISTRO_NAME ||
    (tryCmd("uname -a") || "").toLowerCase().includes("microsoft");
  const node = process.version;
  const platform = `${process.platform} ${process.arch}`;
  const term = process.env.TERM || "(unknown)";
  return { isWsl, node, platform, term };
}

function gitRoot(): string | null {
  return tryCmd("git rev-parse --show-toplevel");
}

function checkFileExecutable(p: string): { exists: boolean; executable: boolean } {
  if (!fs.existsSync(p)) return { exists: false, executable: false };
  try {
    const st = fs.statSync(p);
    const executable = (st.mode & 0o111) !== 0;
    return { exists: true, executable };
  } catch {
    return { exists: true, executable: false };
  }
}

function grade(okCount: number, total: number): { label: string; tone: Tone } {
  if (total <= 0) return { label: "N/A", tone: "muted" };
  if (okCount === total) return { label: "PASS", tone: "ok" };
  if (okCount >= Math.max(1, Math.floor(total * 0.6))) return { label: "WARN", tone: "warn" };
  return { label: "FAIL", tone: "err" };
}

export async function runDoctor() {
  const backendBase = baseNoApiV1(API_BASE).replace(/\/$/, "");
  const threshold = (process.env.CONFIDENCE_THRESHOLD || "0.60").trim();

  const ctx = detectRuntimeContext();

  printHeader({
    status: [
      { label: "Command", value: "DOCTOR", tone: "info" },
      { label: "Backend", value: backendBase, tone: "muted" },
      { label: "Node", value: ctx.node, tone: "muted" },
    ],
  });

  // ------------------------
  // Effective Config
  // ------------------------
  section("Effective Config", "What the CLI will actually use");
  kv("API_BASE", API_BASE, "info");
  kv("backend", backendBase, "muted");
  kv("threshold", threshold, "warn");
  kv("platform", ctx.platform, "muted");
  if (ctx.isWsl) kv("runtime", "WSL detected", "warn");
  spacer(1);

  // ------------------------
  // Environment Presence (safe)
  // ------------------------
  section("Environment", "Presence only (safe for demos)");
  const vars = [
    "INFINITYSNAP_API",
    "INFINITY_BACKEND_URL",
    "NEXT_PUBLIC_BACKEND_URL",
    "BACKEND_URL",
    "CONFIDENCE_THRESHOLD",
    "OUMI_API_URL",
    "OUMI_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
  ];

  const present = vars.filter((k) => isTruthy(process.env[k]));
  const missing = vars.filter((k) => !isTruthy(process.env[k]));

  if (present.length) ok(`Present: ${present.join(", ")}`);
  else warn("No relevant env vars detected in this shell");

  if (missing.length) console.log(chalk.gray(`Missing (may be OK): ${missing.join(", ")}`));

  console.log(chalk.gray("Key fingerprints (masked):"));
  const keyPairs: Array<[string, string | undefined]> = [
    ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
    ["ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY],
    ["OUMI_API_KEY", process.env.OUMI_API_KEY],
  ];
  for (const [k, v] of keyPairs) {
    if (v) console.log(chalk.gray(`- ${k}: ${maskSecret(v)}`));
  }
  spacer(1);

  // ------------------------
  // Backend Connectivity
  // ------------------------
  section("Backend Connectivity", "Required for snap/fix/watch/list/view");

  const checks: Array<Promise<boolean>> = [
    checkEndpoint("health", `${backendBase}/api/v1/health`),
    checkEndpoint("results", `${backendBase}/api/v1/results`),
    checkEndpoint("runs", `${backendBase}/api/v1/runs`),
  ];

  const results = await Promise.all(checks);
  const okCount = results.filter(Boolean).length;
  const g = grade(okCount, results.length);

  box(
    "Backend Score",
    [
      `${badge(g.label, g.tone)} ${okCount}/${results.length} endpoints reachable`,
      okCount === results.length
        ? chalk.gray('Next: run a full pipeline:  infinitysnap fix . --command "npm test"')
        : chalk.gray("If you see ECONNREFUSED 127.0.0.1:4000, backend is not running."),
      okCount === results.length ? "" : chalk.cyan("Start backend:  cd backend && npm run dev"),
    ].filter(Boolean),
    g.tone === "ok" ? "ok" : g.tone === "warn" ? "warn" : "err"
  );

  spacer(1);

  // ------------------------
  // Cline CLI (still optional)
  // ------------------------
  section("Cline CLI", "Optional (local executor integration)");

  const clineOk = hasCommand("cline");
  if (clineOk) {
    ok("cline found in PATH");
    const v = tryCmd("cline version");
    if (v) console.log(chalk.gray(v.split("\n").slice(0, 10).join("\n")));
    const who = tryCmd("cline whoami");
    if (who) console.log(chalk.gray(who.split("\n").slice(0, 8).join("\n")));
    else console.log(chalk.gray("cline whoami: (not available / requires auth)"));
  } else {
    warn("cline not found in PATH");
    box(
      "Install Cline",
      [
        `${badge("TIP", "info")} Install: ${chalk.cyan("npm i -g cline")}`,
        `${badge("TIP", "info")} Then:    ${chalk.cyan("cline auth")}`,
      ],
      "info"
    );
  }

  spacer(1);

  // ------------------------
  // Repo Sanity
  // ------------------------
  section("Repo Sanity", "Hooks + scripts + paths");

  const root = gitRoot();
  if (!root) {
    warn("Not inside a git repo (cannot check hooks/scripts).");
  } else {
    ok(`Repo root: ${root}`);

    const clineSh = path.join(root, "scripts", "cline.sh");
    const st = checkFileExecutable(clineSh);

    if (!st.exists) warn("scripts/cline.sh not found");
    else if (!st.executable) warn("scripts/cline.sh exists but is not executable (chmod +x scripts/cline.sh)");
    else ok("scripts/cline.sh is executable");

    console.log(chalk.gray("Shell rc files (FYI):"));
    detectShellRcFiles().forEach((p) => console.log(chalk.gray(`- ${p}`)));
  }

  spacer(1);

  // ------------------------
  // Final "Next" box (judge friendly)
  // ------------------------
  box(
    "Next Commands",
    [
      `${badge("TRY", "ok")}  ${chalk.cyan('infinitysnap fix . --command "npm test"')}`,
      `${badge("TRY", "ok")}  ${chalk.cyan("infinitysnap list")}`,
      `${badge("TRY", "ok")}  ${chalk.cyan("infinitysnap watch <runId>")}`,
      `${badge("NOTE", "muted")} If watch/list show nothing, backend may not be writing results yet.`,
    ],
    "info"
  );

  if (ctx.isWsl) {
    console.log(chalk.gray("\nWSL note: use Linux paths (/mnt/c/...) when passing repo paths."));
  }
}
