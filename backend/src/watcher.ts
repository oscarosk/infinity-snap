// backend/src/watcher.ts
import { EventEmitter } from "events";
import fs from "fs/promises";
import { runFilePath } from "./runStore";

export class RunWatcher extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private lastMtime = 0;

  constructor(private runId: string, private intervalMs = 750) {
    super();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      try {
        const file = runFilePath(this.runId);
        const stat = await fs.stat(file);
        const mtime = stat.mtimeMs || 0;
        if (mtime > this.lastMtime) {
          this.lastMtime = mtime;
          const raw = await fs.readFile(file, "utf8");
          this.emit("update", JSON.parse(raw));
        }
      } catch (e) {
        this.emit("error", e);
      }
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
