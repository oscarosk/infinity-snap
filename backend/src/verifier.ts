// backend/src/verifier.ts
import fs from "fs/promises";
import path from "path";

import type { RunResult } from "./sandboxRunner";
import { runInSandbox } from "./sandboxRunner";
import {
  metricsFilePath,
  readRun,
  saveRun,
  appendStep,
  writeLog,
  writeMetrics,
  artifactsDirFor,
} from "./runStore";
import { clampLog, checkCommand } from "./policy";
import { trace } from "./logger";

function normalizeTimeoutMs(timeoutMs?: number) {
  const n = Number(timeoutMs);
  if (!Number.isFinite(n) || n <= 0) return 60_000;
  return Math.max(1_000, n);
}

async function withHardTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout?: () => Promise<void> | void
): Promise<T> {
  let t: NodeJS.Timeout | null = null;

  const timeout = new Promise<T>((_, reject) => {
    t = setTimeout(async () => {
      try {
        await onTimeout?.();
      } catch {}
      reject(new Error(`timeout_after_${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export async function verifyRun(
  runId: string,
  opts: { command?: string; timeoutMs?: number; dockerImage?: string } = {}
) {
  const run: any = await readRun(runId);

  const commandToRun =
    String(opts.command || run.command || run.runResult?.command || "npm test").trim();

  const cmdDecision = checkCommand(commandToRun);
  if (!cmdDecision.ok) {
    throw new Error(`${cmdDecision.code}: ${cmdDecision.reason}`);
  }

  const timeoutMs = normalizeTimeoutMs(opts.timeoutMs);
  const hardMs = Math.max(10_000, timeoutMs + 5_000);

  const traceFile = path.join(artifactsDirFor(runId), "verify.trace.log");

  await trace(traceFile, "verify.start", {
    runId,
    repoPath: run.repoPath,
    command: commandToRun,
    timeoutMs,
    hardMs,
    dockerImage: opts.dockerImage ?? null,
  });

  await appendStep(runId, {
    type: "verify.start",
    message: "Verifying fix (direct runner)",
    ts: Date.now(),
    meta: { command: commandToRun, timeoutMs, dockerImage: opts.dockerImage ?? null },
  });

  const t0 = Date.now();

  let verifyResult: RunResult;
  try {
    verifyResult = await withHardTimeout(
      runInSandbox({
        repoPathOnHost: run.repoPath,
        command: commandToRun,
        timeoutMs,
        cleanup: true,
        dockerImage: opts.dockerImage,
      }),
      hardMs,
      async () => {
        await trace(traceFile, "verify.hard_timeout", { runId, hardMs, timeoutMs });
        await appendStep(runId, {
          type: "verify.timeout",
          message: `Verify exceeded hard timeout (${hardMs}ms)`,
          ts: Date.now(),
          meta: { hardTimeoutMs: hardMs, timeoutMs },
        });
      }
    );
  } catch (e: any) {
    const msg = e?.message || String(e);
    await trace(traceFile, "verify.exception", { runId, msg });

    // Write something useful for debugging
    run.logPaths = run.logPaths || {};
    run.logPaths["verify.error"] = await writeLog(
      runId,
      "verify.error",
      clampLog(`verify exception: ${msg}`)
    );

    run.verify = {
      verifiedAt: new Date().toISOString(),
      result: { ok: false, error: msg, code: null, command: commandToRun },
    };

    run.status = "verified_failed";
    await saveRun(run);

    const t1 = Date.now();
    const metricsRaw = await fs
      .readFile(metricsFilePath(runId), "utf8")
      .catch(() => "{}");
    const metrics = JSON.parse(metricsRaw || "{}");
    metrics.verifyMs = t1 - t0;
    metrics.lastVerifyAt = new Date().toISOString();
    await writeMetrics(runId, metrics);

    await appendStep(runId, {
      type: "verify.complete",
      message: "Verification failed (exception)",
      ts: Date.now(),
      meta: { durationMs: t1 - t0, exitCode: null, error: msg },
    });

    return { runId, verifyResult: run.verify.result as RunResult, logPaths: run.logPaths };
  }

  const t1 = Date.now();

  await trace(traceFile, "verify.done", {
    runId,
    ok: !!verifyResult.ok,
    code: verifyResult.code ?? null,
    durationMs: t1 - t0,
    execMs: verifyResult.execMs ?? null,
    mode: (verifyResult as any).mode ?? null,
  });

  run.logPaths = run.logPaths || {};

  const safeStdout = clampLog(verifyResult.stdout || "");
  const safeStderr = clampLog(verifyResult.stderr || "");

  run.logPaths["verify.stdout"] = await writeLog(runId, "verify.stdout", safeStdout);
  run.logPaths["verify.stderr"] = await writeLog(runId, "verify.stderr", safeStderr);

  run.verify = { verifiedAt: new Date().toISOString(), result: verifyResult };

  // ✅ Status should reflect pass/fail
  run.status = verifyResult.ok ? "verified_passed" : "verified_failed";

  const metricsRaw = await fs.readFile(metricsFilePath(runId), "utf8").catch(() => "{}");
  const metrics = JSON.parse(metricsRaw || "{}");
  metrics.verifyMs = t1 - t0;
  metrics.lastVerifyAt = new Date().toISOString();
  await writeMetrics(runId, metrics);

  await saveRun(run);

  await appendStep(runId, {
    type: "verify.complete",
    message: verifyResult.ok ? "Verification passed" : "Verification failed",
    ts: Date.now(),
    meta: {
      durationMs: t1 - t0,
      exitCode: verifyResult.code ?? null,
    },
  });

  return { runId, verifyResult, logPaths: run.logPaths, traceFile };
}
