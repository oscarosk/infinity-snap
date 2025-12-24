// backend/src/sandboxRunner.ts
import { exec as _exec, ExecException } from "child_process";
import util from "util";
import fs from "fs/promises";
import path from "path";

import { makeTempDir } from "./util";
import { trace } from "./logger";

const exec = util.promisify(_exec);

export type RunResult = {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  code?: number | null;
  error?: string;

  tmpDir?: string;
  command?: string;

  durationMs?: number;
  copyMs?: number;
  execMs?: number;

  mode?: "direct" | "sandbox";
};

export type SandboxOptions = {
  repoPathOnHost: string;
  command: string;
  timeoutMs?: number;
  cleanup?: boolean;
  dockerImage?: string;

  mode?: "direct" | "sandbox";
  traceFile?: string;
};

const MAX_BUFFER = 1024 * 1024 * 50;

function normalizeTimeoutMs(timeoutMs?: number) {
  const n = Number(timeoutMs);
  if (!Number.isFinite(n) || n <= 0) return 60_000;
  return Math.max(1_000, n);
}

// ✅ FIX: repo root from /repo/backend/src or /repo/backend/dist => /repo
function repoRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

function resolveRepoPathOnHost(p: string): string {
  const s = String(p || "").trim();
  if (!s) return s;
  return path.isAbsolute(s) ? s : path.resolve(repoRoot(), s);
}

async function copyRepoWithExcludes(srcAbs: string, destAbs: string) {
  await fs.mkdir(destAbs, { recursive: true });

  const excludes = [
    ".git",
    "node_modules",
    ".next",
    "dist",
    "build",
    "coverage",
    ".cache",
    ".turbo",
    ".vercel",
    ".DS_Store",
    "backend/.data",
  ];

  const exFlags = excludes.map((e) => `--exclude='${e}'`).join(" ");
  const cmd = `bash -lc "cd '${srcAbs.replace(/'/g, "'\\''")}' && tar -cf - ${exFlags} . | (cd '${destAbs.replace(/'/g, "'\\''")}' && tar -xf -)"`;
  await exec(cmd, { maxBuffer: MAX_BUFFER });
}

/**
 * runInSandbox supports:
 * - mode=direct (default): run command in repoPathOnHost directly (FAST)
 * - mode=sandbox: copy repo into temp dir (with excludes) and run there (SAFE)
 */
export async function runInSandbox(opts: SandboxOptions): Promise<RunResult> {
  const mode = (opts.mode || "direct") as "direct" | "sandbox";
  const timeoutMs = normalizeTimeoutMs(opts.timeoutMs);
  const { repoPathOnHost, command, cleanup = true, dockerImage, traceFile } = opts;

  await trace(traceFile, "sandbox.enter", { repoPathOnHost, command, timeoutMs, mode });

  if (!repoPathOnHost || !command) {
    return { ok: false, error: "repoPathOnHost and command are required" };
  }

  const absSrc = resolveRepoPathOnHost(repoPathOnHost);

  await trace(traceFile, "sandbox.stat.start", { absSrc });
  try {
    const st = await fs.stat(absSrc);
    if (!st.isDirectory()) return { ok: false, error: `Source path is not a directory: ${absSrc}` };
  } catch {
    return { ok: false, error: `Source path does not exist: ${absSrc}` };
  }
  await trace(traceFile, "sandbox.stat.ok", { absSrc });

  const t0 = Date.now();

  // ======================================================
  // DIRECT MODE (FAST)
  // ======================================================
  if (mode === "direct") {
    const e0 = Date.now();
    await trace(traceFile, "sandbox.exec.start", { cwd: absSrc, command });

    try {
      const { stdout, stderr } = await exec(command, {
        cwd: absSrc,
        maxBuffer: MAX_BUFFER,
        timeout: Math.max(5_000, timeoutMs),
        killSignal: "SIGKILL",
      } as any);

      const execMs = Date.now() - e0;
      await trace(traceFile, "sandbox.exec.ok", { execMs });

      return {
        ok: true,
        stdout: stdout?.toString(),
        stderr: stderr?.toString(),
        code: 0,
        command,
        durationMs: Date.now() - t0,
        copyMs: 0,
        execMs,
        mode: "direct",
      };
    } catch (e: any) {
      const err = e as ExecException & { stdout?: string | Buffer; stderr?: string | Buffer };
      const execMs = Date.now() - e0;

      await trace(traceFile, "sandbox.exec.fail", {
        execMs,
        message: err?.message || String(err),
        code: typeof err?.code === "number" ? err.code : null,
      });

      return {
        ok: false,
        error: err?.message ?? "Command failed",
        stdout: err?.stdout != null ? err.stdout.toString() : undefined,
        stderr: err?.stderr != null ? err.stderr.toString() : undefined,
        code: typeof err?.code === "number" ? err.code : null,
        command,
        durationMs: Date.now() - t0,
        copyMs: 0,
        execMs,
        mode: "direct",
      };
    }
  }

  // ======================================================
  // SANDBOX MODE (SAFE)
  // ======================================================
  const tmpDir = await makeTempDir("snap");
  const destRepo = path.join(tmpDir, "repo");

  let copyMs = 0;
  let execMs = 0;

  const finish = async (result: RunResult): Promise<RunResult> => {
    result.durationMs = Date.now() - t0;
    result.copyMs = copyMs;
    result.execMs = execMs;
    result.mode = "sandbox";

    if (cleanup) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {}
      result.tmpDir = undefined;
    } else {
      result.tmpDir = tmpDir;
    }

    return result;
  };

  try {
    const c0 = Date.now();
    await trace(traceFile, "sandbox.copy.start", { from: absSrc, to: destRepo });
    await copyRepoWithExcludes(absSrc, destRepo);
    copyMs = Date.now() - c0;
    await trace(traceFile, "sandbox.copy.ok", { copyMs });
  } catch (e: any) {
    await trace(traceFile, "sandbox.copy.fail", { message: e?.message || String(e) });
    return finish({ ok: false, error: `Failed to copy repo: ${e?.message || String(e)}`, command, code: null });
  }

  try {
    const e0 = Date.now();
    await trace(traceFile, "sandbox.exec.start", { cwd: destRepo, command });

    const execOpts: any = {
      maxBuffer: MAX_BUFFER,
      timeout: Math.max(5_000, timeoutMs),
      killSignal: "SIGKILL",
    };

    if (dockerImage) {
      const safeCmd = command.replace(/"/g, '\\"');
      const dockerCmd = `docker run --rm -v "${destRepo}:/work" -w /work ${dockerImage} sh -lc "${safeCmd}"`;
      const { stdout, stderr } = await exec(dockerCmd, execOpts);
      execMs = Date.now() - e0;
      await trace(traceFile, "sandbox.exec.ok", { execMs });

      return finish({ ok: true, stdout: stdout?.toString(), stderr: stderr?.toString(), code: 0, command });
    }

    const { stdout, stderr } = await exec(command, { ...execOpts, cwd: destRepo });
    execMs = Date.now() - e0;
    await trace(traceFile, "sandbox.exec.ok", { execMs });

    return finish({ ok: true, stdout: stdout?.toString(), stderr: stderr?.toString(), code: 0, command });
  } catch (e: any) {
    const err = e as ExecException & { stdout?: string | Buffer; stderr?: string | Buffer };

    await trace(traceFile, "sandbox.exec.fail", {
      message: err?.message || String(err),
      code: typeof err?.code === "number" ? err.code : null,
    });

    return finish({
      ok: false,
      error: err?.message ?? "Command failed",
      stdout: err?.stdout != null ? err.stdout.toString() : undefined,
      stderr: err?.stderr != null ? err.stderr.toString() : undefined,
      code: typeof err?.code === "number" ? err.code : null,
      command,
    });
  }
}
