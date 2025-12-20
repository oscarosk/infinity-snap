// cli/src/clineFix.ts
import { spawn } from "child_process";

export interface ClineFixOptions {
  cwd: string;
  log: string;
  command: string;
}

export interface ClineFixResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export function runClineFix({ cwd, log, command }: ClineFixOptions): Promise<ClineFixResult> {
  const prompt = `
You are InfinitySnap's AI mechanic.

You are inside a developer's repository (current working directory).
Goal:
1) Identify the root cause using the error log below.
2) Apply minimal, correct code changes directly in this repo.
3) Re-run: ${command}
4) Ensure it passes.
5) Print a short summary at the end (what broke, what changed, result).

Error log:
${log}
`.trim();

  return new Promise((resolve, reject) => {
    // IMPORTANT: Use top-level cline invocation, not `cline task`
    // Flags supported at top-level: -o (oneshot), -y (yolo/non-interactive), -m (act), -F (output)
    const args = [prompt, "-o", "-y", "-m", "act", "-F", "plain"];

    const child = spawn("cline", args, {
      cwd,
      shell: false,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));

    child.on("error", (e) => reject(e));
    child.on("close", (code) => resolve({ exitCode: code, stdout, stderr }));
  });
}
