// backend/src/timeline.ts
import { performance } from "perf_hooks";
import type { TimelineEvent } from "./types";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";

function ensureExt(file: string, ext: ".txt" | ".json") {
  // If file already ends with ext, keep it.
  if (file.toLowerCase().endsWith(ext)) return file;

  // If file ends with the other known ext, swap.
  if (ext === ".json" && file.toLowerCase().endsWith(".txt")) {
    return file.slice(0, -4) + ".json";
  }
  if (ext === ".txt" && file.toLowerCase().endsWith(".json")) {
    return file.slice(0, -5) + ".txt";
  }

  // Otherwise, append.
  return file + ext;
}

export class Timeline {
  private readonly t0 = performance.now();
  private readonly events: TimelineEvent[] = [];

  constructor(private readonly outFile: string) {}

  private nowMs() {
    return Math.max(0, Math.round(performance.now() - this.t0));
  }

  push(e: Omit<TimelineEvent, "t">) {
    this.events.push({ t: this.nowMs(), ...e });
  }

  start(step: string, message?: string, meta?: Record<string, any>) {
    this.push({ step, status: "start", message, meta });
  }

  ok(step: string, message?: string, meta?: Record<string, any>) {
    this.push({ step, status: "ok", message, meta });
  }

  fail(step: string, message?: string, meta?: Record<string, any>) {
    this.push({ step, status: "fail", message, meta });
  }

  skip(step: string, message?: string, meta?: Record<string, any>) {
    this.push({ step, status: "skip", message, meta });
  }

  /**
   * Writes:
   * - timeline.txt  (human-friendly)
   * - timeline.json (structured, for UI later)
   */
  async flush() {
    const txtPath = ensureExt(this.outFile, ".txt");
    const jsonPath = ensureExt(this.outFile, ".json");

    await mkdir(path.dirname(txtPath), { recursive: true });

    const txt =
      this.events.length === 0
        ? ""
        : this.events
            .map(
              (e) =>
                `[${(e.t / 1000).toFixed(2)}s] ${e.step} → ${e.status}${
                  e.message ? ` (${e.message})` : ""
                }`
            )
            .join("\n");

    await writeFile(txtPath, (txt ? txt + "\n" : ""), "utf-8");
    await writeFile(jsonPath, JSON.stringify(this.events, null, 2), "utf-8");
  }

  /**
   * Read timeline.txt safely (returns "" if not found).
   */
  static async readTxt(file: string) {
    try {
      const txtPath = ensureExt(file, ".txt");
      return await readFile(txtPath, "utf-8");
    } catch (e: any) {
      if (e?.code === "ENOENT") return "";
      throw e;
    }
  }

  /**
   * Optional helper if you want to read JSON too (returns null if not found).
   */
  static async readJson(file: string) {
    try {
      const jsonPath = ensureExt(file, ".json");
      const raw = await readFile(jsonPath, "utf-8");
      return JSON.parse(raw) as TimelineEvent[];
    } catch (e: any) {
      if (e?.code === "ENOENT") return null;
      throw e;
    }
  }
}
