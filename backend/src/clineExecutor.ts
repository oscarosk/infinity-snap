// backend/src/clineExecutor.ts
import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { checkPatchPaths } from "./policy";

export type ClineExecOpts = {
  repoPathOnHost?: string;
  targetRepoPathOnHost?: string;
  task: string;
  stdinText: string;
  timeoutMs?: number;
};

export type ClineExecResult = {
  ok: boolean;
  code: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  filesTouched: string[];
  policyBlocked?: { code: string; reason: string; files?: string[] };
};

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function getInfinitySnapRoot(): string {
  return path.resolve(process.env.INFINITYSNAP_ROOT || path.resolve(__dirname, "..", ".."));
}

async function detectGitTouchedFiles(repoRoot: string): Promise<string[]> {
  const gitDir = path.join(repoRoot, ".git");
  if (!(await exists(gitDir))) return [];

  const out = await new Promise<string>((resolve) => {
    const p = spawn("git", ["status", "--porcelain"], { cwd: repoRoot });
    let s = "";
    p.stdout.on("data", (d) => (s += String(d)));
    p.on("close", () => resolve(s));
    p.on("error", () => resolve(""));
  });

  const files = out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const arrow = l.indexOf("->");
      if (arrow !== -1) return l.slice(arrow + 2).trim();
      return l.slice(3).trim();
    })
    .filter(Boolean);

  return Array.from(new Set(files));
}

export async function runClineExecutor(opts: ClineExecOpts): Promise<ClineExecResult> {
  const repoOnHost =
    (opts.repoPathOnHost && String(opts.repoPathOnHost)) ||
    (opts.targetRepoPathOnHost && String(opts.targetRepoPathOnHost)) ||
    "";

  const targetRepoRoot = path.resolve(repoOnHost);
  const task = String(opts.task || "").trim();
  const stdinText = String(opts.stdinText ?? "");
  const timeoutMs = Math.max(5_000, Number(opts.timeoutMs ?? 240_000));

  if (!repoOnHost) throw new Error("repoPathOnHost is required");
  if (!task) throw new Error("task is required");

  const snapRoot = getInfinitySnapRoot();
  const scriptPath = path.join(snapRoot, "scripts", "cline.sh");

  if (!(await exists(scriptPath))) {
    throw new Error(`scripts/cline.sh not found at: ${scriptPath}`);
  }

  const t0 = Date.now();

  const child = spawn("bash", [scriptPath, task], {
    cwd: snapRoot,
    env: {
      ...process.env,
      TERM: "dumb",
      NO_COLOR: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (d) => (stdout += String(d)));
  child.stderr.on("data", (d) => (stderr += String(d)));

  try {
    child.stdin.write(stdinText);
  } catch {}
  try {
    child.stdin.end();
  } catch {}

  const killTimer = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {}
  }, timeoutMs);

  const code: number | null = await new Promise((resolve) => {
    child.on("close", (c) => resolve(typeof c === "number" ? c : null));
    child.on("error", () => resolve(null));
  });

  clearTimeout(killTimer);

  const durationMs = Date.now() - t0;
  const filesTouched = await detectGitTouchedFiles(targetRepoRoot);

  if (filesTouched.length) {
    const decision = checkPatchPaths(filesTouched);
    if (!decision.ok) {
      return {
        ok: false,
        code,
        durationMs,
        stdout,
        stderr,
        filesTouched,
        policyBlocked: { code: decision.code, reason: decision.reason, files: filesTouched },
      };
    }
  }

  return { ok: code === 0, code, durationMs, stdout, stderr, filesTouched };
}
