// backend/src/routes.ts
import express from "express";
import path from "path";
import fs from "fs/promises";
import { performance } from "perf_hooks";
import { spawn } from "node:child_process";

import { runInSandbox, RunResult } from "./sandboxRunner";
import { analyzeFromStdoutStderr, Analysis } from "./analyzer";
import { Timeline } from "./timeline";
import { trace } from "./logger";

import {
  initStore,
  saveRun,
  readRun,
  appendStep,
  writeLog,
  writeMetrics,
  listRuns,
  runFilePath,
  metricsFilePath,
  patchFilePath,
  diffFilePath,
  artifactsDirFor,
  timelineFilePath,
  timelineJsonPath,
  timelineJsonPath as _timelineJsonPath, // (kept for compat)
} from "./runStore";

import { generateRunId, PATCHES_DIR } from "./util";
import { verifyRun } from "./verifier";
import { checkCommand, clampLog } from "./policy";

import type { RunStatus, RunStepEntry, RunRecord } from "./types";

const router = express.Router();

// -----------------------------
// Auth middleware (optional)
// -----------------------------
function requireApiKey(req: any, res: any, next: any) {
  const key = (process.env.BACKEND_API_KEY || "").trim();
  if (!key) return next();
  const got = (req.headers["x-api-key"] || "").toString().trim();
  if (got !== key) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }
  next();
}

// Ensure store dirs exist
const READY = initStore();
async function ensureReady() {
  await READY;
}

// Strict runId
const RUN_ID_RE = /^[a-z0-9]+-[a-z0-9]+$/i;
function assertValidRunId(runId: string) {
  if (!RUN_ID_RE.test(runId)) throw new Error("invalid runId");
}

function safeSendJson(res: any, status: number, body: any) {
  if (res.headersSent) return;
  try {
    res.status(status).json(body);
  } catch {
    // ignore
  }
}

/**
 * Abort latch:
 * - req "aborted" fires on client abort
 * - res "close" fires always; treat as abort only if response not finished
 */
function createAbortLatch(req: any, res: any) {
  let aborted = false;

  req.on("aborted", () => {
    aborted = true;
  });

  res.on("close", () => {
    if (!res.writableEnded) aborted = true;
  });

  return () => aborted;
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

// ============================================================
// Health
// ============================================================
router.get("/health", async (_req, res) => {
  await ensureReady();
  res.json({ ok: true, ts: Date.now(), service: "InfinitySnap backend" });
});

// ============================================================
// Runs list
// ============================================================
router.get("/runs", async (_req, res) => {
  try {
    await ensureReady();
    const runs = await listRuns();
    res.json({ ok: true, runs });
  } catch (e: any) {
    console.error("runs list error:", e);
    res.status(500).json({
      ok: false,
      error: "INTERNAL_ERROR",
      message: e?.message || String(e),
    });
  }
});

// Alias
router.get("/results", async (_req, res) => {
  try {
    await ensureReady();
    const runs = await listRuns();
    res.json({ ok: true, runs });
  } catch (e: any) {
    console.error("results alias error:", e);
    res.status(500).json({
      ok: false,
      error: "INTERNAL_ERROR",
      message: e?.message || String(e),
    });
  }
});

// ============================================================
// Run detail
// ============================================================
router.get("/runs/:id", async (req, res) => {
  try {
    await ensureReady();
    const runId = String(req.params.id || "");
    assertValidRunId(runId);
    const data = await readRun(runId);
    res.json({ ok: true, runId, data });
  } catch {
    res
      .status(404)
      .json({ ok: false, error: "NOT_FOUND", message: "run not found" });
  }
});

// ============================================================
// Logs / Diff / Patch (so CLI/dashboard don’t 404)
// ============================================================
router.get("/runs/:id/logs", async (req, res) => {
  try {
    await ensureReady();
    const runId = String(req.params.id || "");
    assertValidRunId(runId);

    const run = await readRun(runId);
    const logName = String(req.query?.name || "").trim();

    // if ?name=sandbox.stdout return that file content
    if (logName) {
      const p = run?.logPaths?.[logName];
      if (!p) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
      const txt = await fs.readFile(p, "utf-8");
      return res.type("text/plain").send(txt);
    }

    // else return map
    return res.json({ ok: true, runId, logPaths: run?.logPaths || {} });
  } catch {
    return res.status(404).json({ ok: false, error: "NOT_FOUND" });
  }
});

router.get("/runs/:id/diff", async (req, res) => {
  try {
    await ensureReady();
    const runId = String(req.params.id || "");
    assertValidRunId(runId);
    const txt = await fs.readFile(diffFilePath(runId), "utf-8");
    return res.type("text/plain").send(txt);
  } catch {
    return res.status(404).type("text/plain").send("");
  }
});

router.get("/runs/:id/patch", async (req, res) => {
  try {
    await ensureReady();
    const runId = String(req.params.id || "");
    assertValidRunId(runId);
    const txt = await fs.readFile(patchFilePath(runId), "utf-8");
    return res.type("application/json").send(txt);
  } catch {
    return res.status(404).type("application/json").send("[]");
  }
});

// ============================================================
// Timeline
// ============================================================
router.get("/runs/:id/timeline", async (req, res) => {
  try {
    await ensureReady();
    const runId = String(req.params.id || "");
    assertValidRunId(runId);
    const txt = await Timeline.readTxt(timelineFilePath(runId));
    res.type("text/plain").send(txt);
  } catch {
    res.status(404).type("text/plain").send("No timeline for this run yet.");
  }
});

router.get("/runs/:id/timeline.json", async (req, res) => {
  try {
    await ensureReady();
    const runId = String(req.params.id || "");
    assertValidRunId(runId);
    const json = await fs.readFile(timelineJsonPath(runId), "utf-8");
    res.json(JSON.parse(json));
  } catch {
    res.status(404).type("text/plain").send("No timeline json for this run yet.");
  }
});

// ============================================================
// POST /runs/start  (Alias: POST /snap)
// ============================================================
async function handleRunsStart(req: any, res: any) {
  let runId: string | null = null;
  let timeline: Timeline | null = null;
  let timelineFlushed = false;
  let traceFile: string | null = null;

  const isAborted = createAbortLatch(req, res);

  try {
    await ensureReady();
    const wallT0 = Date.now();

    const rawPath: string | undefined =
      req.body?.repoPathOnHost ||
      req.body?.repoHostPath ||
      req.body?.path ||
      req.body?.repoPath;

    const command: string | undefined = req.body?.command;

    const timeoutMsRaw: number | undefined = req.body?.timeoutMs;
    const timeoutMs: number = Number.isFinite(Number(timeoutMsRaw))
      ? Math.max(1_000, Number(timeoutMsRaw))
      : 60_000;

    const cleanup: boolean =
      req.body?.cleanup === undefined ? true : !!req.body?.cleanup;

    const dockerImage: string | undefined = req.body?.dockerImage;

    if (!rawPath || !command) {
      return safeSendJson(res, 400, {
        ok: false,
        error: "BAD_REQUEST",
        message:
          "Require repoPathOnHost (or repoHostPath/path/repoPath) and command.",
      });
    }

    // POLICY: validate command
    const cmdDecision = checkCommand(command);
    if (!cmdDecision.ok) {
      return safeSendJson(res, 400, {
        ok: false,
        error: cmdDecision.code,
        message: cmdDecision.reason,
      });
    }

    // Resolve repo path robustly
    const candidates = [
      path.resolve(rawPath),
      path.resolve(process.cwd(), rawPath),
      path.resolve(__dirname, "../../", rawPath),
    ];

    let absSrc: string | null = null;
    let lastErr: any = null;

    for (const c of candidates) {
      try {
        await fs.access(c);
        absSrc = c;
        break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!absSrc) {
      return safeSendJson(res, 400, {
        ok: false,
        error: "SOURCE_NOT_FOUND",
        message: `Source path not found. Tried:\n${candidates.join(
          "\n"
        )}\nLast error: ${lastErr?.message || lastErr}`,
      });
    }

    runId = generateRunId();
    traceFile = path.join(artifactsDirFor(runId), "snap.trace.log");

    await trace(traceFile, "snap.start", {
      runId,
      rawPath,
      absSrc,
      command,
      timeoutMs,
      cleanup,
      dockerImage: dockerImage ?? null,
    });

    // Runner mode:
    // Default = DIRECT (fast)
    // Set INFINITYSNAP_SAFE_MODE=1 to force SANDBOX
    const safeMode = String(process.env.INFINITYSNAP_SAFE_MODE || "").trim() === "1";
    const mode = safeMode ? "sandbox" : "direct";

    timeline = new Timeline(timelineFilePath(runId));
    timeline.start("run.init", "initializing", { repoPath: absSrc, command, mode });

    const runRecord: RunRecord = {
      runId,
      repoPath: absSrc,
      command,
      status: "running" as RunStatus,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      lastUpdatedAt: new Date().toISOString(),
      steps: [] as RunStepEntry[],
      logPaths: {},
      diffPath: null,
      confidence: { score: null, reasons: [] } as any,
      metricsPath: metricsFilePath(runId),
      patchPath: null,
      artifactsDir: artifactsDirFor(runId),
    };

    await saveRun(runRecord);

    await appendStep(runId, {
      type: "run.start",
      message: "Run initialized",
      ts: Date.now(),
      meta: { repoPath: absSrc, command, dockerImage: dockerImage || null, mode },
    });

    // If client aborted before we began
    if (isAborted()) {
      await trace(traceFile, "snap.aborted_before_run", { runId });
      runRecord.status = "aborted" as any;
      runRecord.finishedAt = new Date().toISOString();
      runRecord.lastUpdatedAt = new Date().toISOString();
      await saveRun(runRecord);
      try {
        timeline.fail("run.aborted", "client_disconnected");
        await timeline.flush();
      } catch {}
      return;
    }

    // Hard timeout so API returns cleanly
    const hardMs = Math.max(70_000, timeoutMs + 10_000);

    timeline.start("sandbox.run", command, {
      timeoutMs,
      cleanup,
      dockerImage: dockerImage ?? null,
      mode,
    });

    const sb0 = performance.now();
    await trace(traceFile, "snap.before_runInSandbox", {
      runId,
      absSrc,
      command,
      timeoutMs,
      hardMs,
      mode,
    });

    let runResult: RunResult;

    try {
      runResult = await withHardTimeout(
        runInSandbox({
          repoPathOnHost: absSrc,
          command,
          timeoutMs,
          cleanup,
          dockerImage,
          mode,
          traceFile,
        } as any),
        hardMs,
        async () => {
          await trace(traceFile!, "snap.hard_timeout", {
            runId,
            hardMs,
            timeoutMs,
            mode,
          });
          await appendStep(runId!, {
            type: "sandbox.timeout",
            message: `Runner exceeded hard timeout (${hardMs}ms)`,
            ts: Date.now(),
            meta: { hardTimeoutMs: hardMs, timeoutMs, mode },
          });
        }
      );
    } catch (e: any) {
      const msg = e?.message || String(e);

      await trace(traceFile, "snap.catch_timeout_or_error", { runId, msg, mode });

      runRecord.status = "timeout" as any;
      runRecord.finishedAt = new Date().toISOString();
      runRecord.lastUpdatedAt = new Date().toISOString();

      runRecord.logPaths["sandbox.error"] = await writeLog(
        runId,
        "sandbox.error",
        clampLog(
          `Runner failed/timeout.\nerror=${msg}\ncommand=${command}\nrepo=${absSrc}\ntimeoutMs=${timeoutMs}\nhardMs=${hardMs}\nmode=${mode}`
        )
      );

      await saveRun(runRecord);

      try {
        timeline.fail("sandbox.run", msg);
        timeline.ok("run.complete", "timeout");
        await timeline.flush();
        timelineFlushed = true;
      } catch {}

      if (!isAborted()) {
        return safeSendJson(res, 504, {
          ok: false,
          runId,
          error: "SANDBOX_TIMEOUT",
          message: `Runner did not complete within ${hardMs}ms (timeoutMs=${timeoutMs}).`,
          logPaths: runRecord.logPaths,
          runFile: runFilePath(runId),
          traceFile,
          mode,
        });
      }
      return;
    }

    const sbMs = performance.now() - sb0;

    timeline.ok(
      "sandbox.run",
      `ok=${!!runResult.ok} exit=${runResult.code ?? 0} duration=${sbMs.toFixed(
        0
      )}ms mode=${(runResult as any).mode ?? mode}`
    );

    // POLICY: clamp logs
    const safeStdout = clampLog(runResult.stdout || "");
    const safeStderr = clampLog(runResult.stderr || "");

    const stdoutPath = await writeLog(runId, "sandbox.stdout", safeStdout);
    const stderrPath = await writeLog(runId, "sandbox.stderr", safeStderr);

    runRecord.logPaths["sandbox.stdout"] = stdoutPath;
    runRecord.logPaths["sandbox.stderr"] = stderrPath;

    // Analyze
    timeline.start("analysis.complete", "analyzing stdout/stderr");
    const an0 = performance.now();
    const analysis: Analysis = analyzeFromStdoutStderr(safeStdout, safeStderr);
    const anMs = performance.now() - an0;
    timeline.ok("analysis.complete", `duration=${anMs.toFixed(0)}ms`);

    runRecord.finishedAt = new Date().toISOString();
    runRecord.status = runResult.ok
      ? ("finished" as RunStatus)
      : ("failed" as RunStatus);

    (runRecord as any).runResult = {
      ...runResult,
      stdout: safeStdout,
      stderr: safeStderr,
    };
    (runRecord as any).analysis = analysis;

    runRecord.lastUpdatedAt = new Date().toISOString();

    await writeMetrics(runId, {
      runId,
      totalMs: Date.now() - wallT0,
      sandboxMs: Math.round(sbMs),
      analysisMs: Math.round(anMs),
      ts: new Date().toISOString(),
      mode: (runResult as any).mode ?? mode,
    });

    await saveRun(runRecord);

    timeline.ok("run.complete", runRecord.status);
    await timeline.flush();
    timelineFlushed = true;

    if (isAborted()) return;

    return safeSendJson(res, 200, {
      ok: true,
      runId,
      status: runRecord.status,
      analysis,
      runResult: (runRecord as any).runResult,
      logPaths: runRecord.logPaths,
      metricsPath: runRecord.metricsPath,
      runFile: runFilePath(runId),
      traceFile,
      mode: (runResult as any).mode ?? mode,
    });
  } catch (e: any) {
    console.error("runs/start error:", e);

    try {
      if (traceFile) {
        await trace(traceFile, "snap.top_level_error", {
          err: e?.message || String(e),
        });
      }
    } catch {}

    try {
      if (timeline && !timelineFlushed) {
        timeline.fail("run.error", e?.message || String(e));
        await timeline.flush();
      }
    } catch {}

    if (!res.headersSent) {
      return safeSendJson(res, 500, {
        ok: false,
        error: "INTERNAL_ERROR",
        message: e?.message || String(e),
        traceFile,
      });
    }
  }
}

router.post("/runs/start", requireApiKey, handleRunsStart);
router.post("/snap", requireApiKey, handleRunsStart);

// ============================================================
// Helpers: run Cline via scripts/cline.sh
// ============================================================
function projectRoot(): string {
  // When compiled, __dirname is backend/dist. This resolves to repo root.
  return path.resolve(__dirname, "..", "..");
}

function clineScriptPath(): string {
  return path.resolve(projectRoot(), "scripts", "cline.sh");
}

async function runGitDiff(repoPath: string): Promise<string> {
  return await new Promise<string>((resolve) => {
    const child = spawn("bash", ["-lc", `git -C "${repoPath}" diff`], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));

    child.on("close", () => {
      // If not a git repo, diff will be empty or stderr will mention it.
      // We return stdout only; callers can store stderr separately if needed.
      resolve(out || "");
    });

    child.on("error", () => resolve(""));
  });
}

async function runClineFixOnce(opts: {
  runId: string;
  repoPath: string;
  command: string;
  analysisSummary: string;
  stdout: string;
  stderr: string;
  hardMs: number;
}): Promise<{ ok: boolean; output: string; reason?: string }> {
  const script = clineScriptPath();
  const scriptExists = await fs
    .access(script)
    .then(() => true)
    .catch(() => false);

  if (!scriptExists) {
    return { ok: false, output: "", reason: `Missing ${script}` };
  }

  // Build stdin context (this becomes /workspace/.infinitysnap_stdin.txt inside container)
  const ctx = [
    `RunId: ${opts.runId}`,
    `Repo: ${opts.repoPath}`,
    `Command: ${opts.command}`,
    ``,
    `ANALYSIS SUMMARY:`,
    opts.analysisSummary,
    ``,
    `STDERR (clamped):`,
    clampLog(opts.stderr),
    ``,
    `STDOUT (clamped):`,
    clampLog(opts.stdout),
    ``,
    `TASK: Fix the repo so "${opts.command}" passes.`,
    `Constraints: small, minimal change; do not add new deps unless necessary; keep tests passing.`,
  ].join("\n");

  const task = `Fix the failing tests for command: ${opts.command}. Ensure all tests pass.`;

  const p = new Promise<{ ok: boolean; output: string; reason?: string }>((resolve) => {
    const child = spawn("bash", ["-lc", `"${script}" "${task.replace(/"/g, '\\"')}"`], {
      cwd: projectRoot(),
      env: {
        ...process.env,
        // IMPORTANT: backend must have keys in its env OR repo root .env loaded by script
        // Keep these as-is; do not force.
        CLINE_TELEMETRY_DISABLED: "1",
        NO_COLOR: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let out = "";
    let err = "";

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));

    child.on("error", (e) => {
      resolve({ ok: false, output: out + "\n" + err, reason: e.message });
    });

    child.on("close", (code) => {
      const combined = (out + "\n" + err).trim();
      resolve({ ok: code === 0, output: combined || "", reason: code === 0 ? undefined : `exit_${code}` });
    });

    // send stdin context
    child.stdin.write(ctx);
    child.stdin.end();
  });

  return await withHardTimeout(p, opts.hardMs, async () => {
    // nothing else to do; process will be left to OS, but route will exit cleanly
  });
}

// ============================================================
// FIX PIPELINE (Cline-only): cline → diff → verify
// POST /runs/:id/fix
// ============================================================
router.post("/runs/:id/fix", requireApiKey, async (req, res) => {
  const runId = String(req.params.id || "").trim();

  try {
    await ensureReady();
    assertValidRunId(runId);

    const run = await readRun(runId).catch(() => null as any);
    if (!run) {
      return safeSendJson(res, 404, {
        ok: false,
        error: "NOT_FOUND",
        message: "run not found",
      });
    }

    const cmd = String(req.body?.command || run.command || "").trim();
    if (!cmd) {
      return safeSendJson(res, 400, { ok: false, error: "BAD_REQUEST", message: "missing command" });
    }

    // POLICY: validate command
    const cmdDecision = checkCommand(cmd);
    if (!cmdDecision.ok) {
      return safeSendJson(res, 400, {
        ok: false,
        error: cmdDecision.code,
        message: cmdDecision.reason,
      });
    }

    const hardMs =
      Number.isFinite(Number(req.body?.timeoutMs)) && Number(req.body?.timeoutMs) > 0
        ? Math.max(10_000, Math.min(20 * 60_000, Number(req.body?.timeoutMs))) // up to 20 min
        : 8 * 60_000; // default 8 min

    const traceFile = path.join(artifactsDirFor(runId), "fix.trace.log");
    await trace(traceFile, "fix.start", { runId, repoPath: run.repoPath, command: cmd, hardMs });

    // Pull analysis/logs from run
    const analysisSummary = String(run.analysis?.summary || run.analysis?.primary || "No analysis summary");
    const stdoutPath = run?.logPaths?.["sandbox.stdout"];
    const stderrPath = run?.logPaths?.["sandbox.stderr"];

    const stdout = stdoutPath ? await fs.readFile(stdoutPath, "utf-8").catch(() => "") : "";
    const stderr = stderrPath ? await fs.readFile(stderrPath, "utf-8").catch(() => "") : "";

    // Run Cline
    await appendStep(runId, { type: "fix.cline.start", message: "Running Cline fix", ts: Date.now(), meta: { hardMs } });

    const cl = await runClineFixOnce({
      runId,
      repoPath: run.repoPath,
      command: cmd,
      analysisSummary,
      stdout,
      stderr,
      hardMs,
    });

    run.logPaths = run.logPaths || {};
    run.logPaths["fix.cline.output"] = await writeLog(runId, "fix.cline.output", clampLog(cl.output || ""));
    run.lastUpdatedAt = new Date().toISOString();

    if (!cl.ok) {
      run.status = "failed";
      await saveRun(run);
      return safeSendJson(res, 200, {
        ok: true,
        runId,
        status: "cline_failed",
        message: "Cline did not complete successfully (see fix.cline.output log).",
        traceFile,
        logPaths: run.logPaths,
      });
    }

    await appendStep(runId, { type: "fix.diff", message: "Capturing git diff", ts: Date.now() });

    // Save git diff (best-effort)
    const diff = await runGitDiff(run.repoPath);
    if (diff) {
      await fs.writeFile(diffFilePath(runId), diff, "utf8").catch(() => {});
      run.diffPath = diffFilePath(runId);
      // store a copy as patch too (so dashboard can show something)
      await fs.writeFile(patchFilePath(runId), JSON.stringify([], null, 2), "utf8").catch(() => {});
      run.patchPath = patchFilePath(runId);
    } else {
      // not a git repo or no diff; still proceed to verify
      run.diffPath = null;
    }

    run.status = "applied";
    run.applied = { appliedAt: new Date().toISOString(), files: [] };
    await saveRun(run);

    // Verify
    await appendStep(runId, { type: "fix.verify.start", message: "Verifying after Cline", ts: Date.now(), meta: { command: cmd } });

    const vr = await verifyRun(runId, {
      command: cmd,
      timeoutMs: req.body?.timeoutMs,
      dockerImage: req.body?.dockerImage,
    });

    run.status = vr.verifyResult?.ok ? "verified" : "failed";
    run.lastUpdatedAt = new Date().toISOString();
    await saveRun(run);

    return safeSendJson(res, 200, {
      ok: true,
      runId,
      status: run.status,
      diffPath: run.diffPath,
      verify: vr.verifyResult,
      logPaths: vr.logPaths,
      traceFile,
    });
  } catch (e: any) {
    console.error("Fix Error:", e);
    return safeSendJson(res, 500, {
      ok: false,
      error: "INTERNAL_ERROR",
      message: e?.message || String(e),
    });
  }
});

export default router;
