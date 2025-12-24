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

function envMs(name: string, fallback: number) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function normalizeTimeoutMs(timeoutMs?: number) {
  const n = Number(timeoutMs);
  if (!Number.isFinite(n) || n <= 0) return 30_000; // ✅ default faster

  // ✅ Demo-safe cap: never let verify exceed this (default 30s)
  const cap = envMs("INFINITYSNAP_VERIFY_CAP_MS", 30_000);
  return Math.max(1_000, Math.min(n, cap));
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

  const commandToRun = String(
    opts.command || run.command || run.runResult?.command || "npm test"
  ).trim();

  const cmdDecision = checkCommand(commandToRun);
  if (!cmdDecision.ok) throw new Error(`${cmdDecision.code}: ${cmdDecision.reason}`);

  const timeoutMs = normalizeTimeoutMs(opts.timeoutMs);

  // hardMs should be slightly > timeoutMs but still bounded
  const hardMs = Math.max(10_000, timeoutMs + 2_000);

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
    message: "Verifying fix (sandbox runner)",
    ts: Date.now(),
    meta: { command: commandToRun, timeoutMs, dockerImage: opts.dockerImage ?? null },
  });

  const t0 = Date.now();

  const controller = new AbortController();

  let verifyResult: RunResult;
  try {
    verifyResult = await withHardTimeout(
      runInSandbox({
        repoPathOnHost: run.repoPath,
        command: commandToRun,
        timeoutMs,
        cleanup: true,
        dockerImage: opts.dockerImage,
        signal: controller.signal, // ✅ requires sandboxRunner support
      } as any),
      hardMs,
      async () => {
        // ✅ actually cancel the sandbox run
        controller.abort();

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

    run.logPaths = run.logPaths || {};
    run.logPaths["verify.error"] = await writeLog(runId, "verify.error", clampLog(`verify exception: ${msg}`));

    run.verify = {
      verifiedAt: new Date().toISOString(),
      result: { ok: false, error: msg, code: null, command: commandToRun },
    };

    // ✅ keep statuses simple / consistent
    run.status = "failed";
    await saveRun(run);

    const t1 = Date.now();
    const metricsRaw = await fs.readFile(metricsFilePath(runId), "utf8").catch(() => "{}");
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

    return { runId, verifyResult: run.verify.result as RunResult, logPaths: run.logPaths, traceFile };
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
  run.logPaths["verify.stdout"] = await writeLog(runId, "verify.stdout", clampLog(verifyResult.stdout || ""));
  run.logPaths["verify.stderr"] = await writeLog(runId, "verify.stderr", clampLog(verifyResult.stderr || ""));

  run.verify = { verifiedAt: new Date().toISOString(), result: verifyResult };

  // ✅ status aligned with CLI expectations
  run.status = verifyResult.ok ? "verified" : "failed";

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
    meta: { durationMs: t1 - t0, exitCode: verifyResult.code ?? null },
  });

  return { runId, verifyResult, logPaths: run.logPaths, traceFile };
}
