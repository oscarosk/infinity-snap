// backend/src/runStore.ts
import fs from "fs/promises";
import path from "path";
import {
  ensureDataDirs,
  RUNS_DIR,
  PATCHES_DIR,
  LOGS_DIR,
  METRICS_DIR,
  DIFFS_DIR,
  ARTIFACTS_DIR,
} from "./util";
import type { RunRecord, RunStepEntry, PatchSuggestion, RunListItem } from "./types";

const RUN_ID_RE = /^[a-z0-9]+-[a-z0-9]+$/i;

function assertValidRunId(runId: string) {
  if (!RUN_ID_RE.test(runId)) throw new Error("invalid runId");
}

function safeJoin(baseDir: string, fileName: string) {
  const full = path.join(baseDir, fileName);
  const resolved = path.resolve(full);
  const baseResolved = path.resolve(baseDir);
  if (!resolved.startsWith(baseResolved + path.sep) && resolved !== baseResolved) {
    throw new Error("path traversal blocked");
  }
  return resolved;
}

export function runFilePath(runId: string) {
  assertValidRunId(runId);
  return safeJoin(RUNS_DIR, `${runId}.json`);
}

export function patchFilePath(runId: string) {
  assertValidRunId(runId);
  return safeJoin(PATCHES_DIR, `${runId}-patch.json`);
}

export function metricsFilePath(runId: string) {
  assertValidRunId(runId);
  return safeJoin(METRICS_DIR, `${runId}.json`);
}

export function logFilePath(runId: string, name: string) {
  assertValidRunId(runId);
  if (!/^[a-z0-9._-]+$/i.test(name)) throw new Error("invalid log name");
  return safeJoin(LOGS_DIR, `${runId}.${name}.txt`);
}

export function diffFilePath(runId: string) {
  assertValidRunId(runId);
  return safeJoin(DIFFS_DIR, `${runId}.diff`);
}

/** Per-run write queue to avoid read-modify-write races */
const queues = new Map<string, Promise<void>>();
async function withLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(runId) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  queues.set(runId, prev.then(() => next));

  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (queues.get(runId) === next) queues.delete(runId);
  }
}

export async function initStore() {
  await ensureDataDirs();
}

export async function saveRun(run: RunRecord) {
  await initStore();
  const file = runFilePath(run.runId);
  await fs.writeFile(file, JSON.stringify(run, null, 2), "utf8");
  return file;
}

export async function readRun(runId: string): Promise<RunRecord> {
  await initStore();
  const raw = await fs.readFile(runFilePath(runId), "utf8");
  return JSON.parse(raw);
}

export async function appendStep(runId: string, entry: RunStepEntry) {
  await initStore();
  return withLock(runId, async () => {
    const run = await readRun(runId);
    run.steps = run.steps || [];
    run.steps.push(entry);
    run.lastUpdatedAt = new Date().toISOString();
    await saveRun(run);
  });
}

export async function writeLog(runId: string, name: string, content: string) {
  await initStore();
  const file = logFilePath(runId, name);
  await fs.writeFile(file, content || "", "utf8").catch(() => {});
  return file;
}

export async function writeMetrics(runId: string, metrics: any) {
  await initStore();
  const file = metricsFilePath(runId);
  await fs.writeFile(file, JSON.stringify(metrics, null, 2), "utf8").catch(() => {});
  return file;
}

export async function savePatch(runId: string, suggestions: PatchSuggestion[]) {
  await initStore();
  const file = patchFilePath(runId);
  await fs.writeFile(file, JSON.stringify(suggestions, null, 2), "utf8");
  return file;
}

export async function listRuns(): Promise<RunListItem[]> {
  await initStore();
  const files = await fs.readdir(RUNS_DIR);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const id = f.replace(".json", "");
      const prefix = id.split("-")[0];
      const ts = /^[a-z0-9]+$/i.test(prefix) ? parseInt(prefix, 36) : 0;
      return { id, file: f, ts };
    })
    .sort((a, b) => b.ts - a.ts);
}

export function artifactsDirFor(runId: string) {
  assertValidRunId(runId);
  return path.join(ARTIFACTS_DIR, runId);
}


export function timelineFilePath(runId: string) {
  return path.join(artifactsDirFor(runId), "timeline.txt");
}
export function timelineJsonPath(runId: string) {
  return path.join(artifactsDirFor(runId), "timeline.json");
}
