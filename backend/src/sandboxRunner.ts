// backend/src/sandboxRunner.ts
import { exec as _exec, ExecException } from "child_process";
import util from "util";
import fs from "fs/promises";
import path from "path";

import { makeTempDir } from "./util";

const exec = util.promisify(_exec);

export type RunResult = {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  code?: number | null;
  error?: string;
  tmpDir?: string;      // path to sandbox (kept for debugging) — removed if cleanup true
  command?: string;     // the command that was executed
  durationMs?: number;  // how long the run took in ms
};

export type SandboxOptions = {
  repoPathOnHost: string; // absolute or relative path to repo folder
  command: string;        // shell command to run inside sandbox (e.g. "npm test" or "node index.js")
  timeoutMs?: number;
  cleanup?: boolean;      // if true, delete sandbox after run (default: false)
  dockerImage?: string;   // if provided, run inside docker using mounted folder
};

const MAX_BUFFER = 1024 * 1024 * 50; // 50MB

/**
 * Copy directory recursively.
 * Prefer fs.cp when available (Node 16.7+). Fallback to robocopy/xcopy or cp -a.
 */
async function copyRecursive(src: string, dest: string): Promise<void> {
  // prefer fs.cp if available at runtime
  // (TypeScript may not have the type, so use any)
  // @ts-ignore
  if (typeof (fs as any).cp === "function") {
    // @ts-ignore
    await (fs as any).cp(src, dest, { recursive: true, force: true });
    return;
  }

  const platform = process.platform;
  await fs.mkdir(dest, { recursive: true });

  if (platform === "win32") {
    // prefer robocopy, fallback silently to xcopy (xcopy may not exist on modern Win)
    try {
      // Note: robocopy returns non-zero exit codes on some successes; we ignore exit code here
      await exec(
        `robocopy "${src}" "${dest}" /E /NFL /NDL /NJH /NJS /MT:8`,
        { windowsHide: true, maxBuffer: MAX_BUFFER }
      );
      return;
    } catch {
      // fallback to xcopy
      await exec(
        `xcopy "${src}" "${dest}" /E /I /Y`,
        { windowsHide: true, maxBuffer: MAX_BUFFER }
      );
      return;
    }
  } else {
    // POSIX
    await exec(`cp -a "${src}/." "${dest}/"`, {
      shell: "/bin/bash",
      maxBuffer: MAX_BUFFER,
    });
    return;
  }
}

/**
 * runInSandbox: copies repo into a temp folder and runs a command.
 * - If dockerImage is provided, runs the command in that docker image with the sandbox mounted at /work.
 * - WARNING: This executes arbitrary project code; never expose directly to untrusted users.
 */
export async function runInSandbox(opts: SandboxOptions): Promise<RunResult> {
  const {
    repoPathOnHost,
    command,
    timeoutMs,
    cleanup = false,
    dockerImage,
  } = opts;

  if (!repoPathOnHost || !command) {
    return { ok: false, error: "repoPathOnHost and command are required" };
  }

  const absSrc = path.resolve(repoPathOnHost);

  try {
    const st = await fs.stat(absSrc);
    if (!st.isDirectory()) {
      return {
        ok: false,
        error: `Source path is not a directory: ${absSrc}`,
      };
    }
  } catch (e: any) {
    return {
      ok: false,
      error: `Source path does not exist: ${absSrc}`,
    };
  }

  const tmpDir = await makeTempDir("snap");
  const dest = path.join(tmpDir, "repo");

  try {
    await copyRecursive(absSrc, dest);
  } catch (e: any) {
    const msg = e?.message || e;
    if (!cleanup) {
      return {
        ok: false,
        error: `Failed to copy repo: ${msg}`,
        tmpDir,
        command,
      };
    }
    // attempt cleanup and return
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
    return {
      ok: false,
      error: `Failed to copy repo: ${msg}`,
      command,
    };
  }

  const start = Date.now();

  const finish = async (result: RunResult): Promise<RunResult> => {
    const durationMs = Date.now() - start;
    result.durationMs = durationMs;
    if (cleanup) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
        result.tmpDir = undefined;
      } catch {
        // ignore cleanup failure
      }
    } else {
      result.tmpDir = tmpDir;
    }
    return result;
  };

  try {
    if (dockerImage) {
      // escape double quotes inside command to place inside sh -c "..."
      const safeCmd = command.replace(/"/g, '\\"');
      const dockerCmd = `docker run --rm -v "${dest}:/work" -w /work ${dockerImage} sh -lc "${safeCmd}"`;

      const { stdout, stderr } = await exec(dockerCmd, {
        timeout: timeoutMs ?? 0,
        maxBuffer: MAX_BUFFER,
      });

      return await finish({
        ok: true,
        stdout: stdout?.toString(),
        stderr: stderr?.toString(),
        code: 0,
        command,
      });
    }

    // Non-docker: run command inside dest using shell.
    // WARNING: this runs arbitrary shell commands.
    const fullCmd = `cd "${dest}" && ${command}`;
    const { stdout, stderr } = await exec(fullCmd, {
      timeout: timeoutMs ?? 0,
      maxBuffer: MAX_BUFFER,
    });

    return await finish({
      ok: true,
      stdout: stdout?.toString(),
      stderr: stderr?.toString(),
      code: 0,
      command,
    });
  } catch (e: any) {
    const err = e as ExecException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };

    const code =
      typeof err?.code === "number" ? err.code : null;

    const stdout =
      err?.stdout != null ? err.stdout.toString() : undefined;
    const stderr =
      err?.stderr != null ? err.stderr.toString() : undefined;

    return await finish({
      ok: false,
      error: err?.message ?? "Command failed",
      stdout,
      stderr,
      code,
      command,
    });
  }
}
